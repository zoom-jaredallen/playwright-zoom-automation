import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";
import dotenv from "dotenv";
import { listAddressProfiles } from "../addressProfiles.js";
import { compileWorkflow, slugify } from "../compiler/compiler.js";
import type { RecordedWorkflow } from "../compiler/types.js";
import { safeParseWorkflow } from "@zoom-automation/workflow-core";
import {
  createFileWorkflowLifecycleStore,
  isLifecycleLiveRunnable,
  type WorkflowLifecycleStatus
} from "./governance/workflowLifecycle.js";
import { filterSelectableAccounts, type AccountSelectionFilters } from "./services/accountSelectionService.js";
import { createFileJobStore } from "./services/fileJobStore.js";
import { createFileWorkItemStore } from "./queues/fileWorkItemStore.js";
import { createJobEventEmitter } from "./services/jobEvents.js";
import { cancelRunningJob, startAutomationJob } from "./services/jobRunner.js";
import { createRetryJobInput, selectRetryAccounts } from "./services/jobRetryService.js";
import { computeDashboardMetrics } from "./services/analytics.js";
import { listJobArtifacts } from "./services/artifacts.js";
import { createSchedulerStore, shouldRunNow, type ScheduleDefinition } from "./services/scheduler.js";
import { isAllowedWebhookUrl, WebhookService } from "./services/webhooks.js";
import { createWorkflowRegistry } from "./services/workflowRegistry.js";
import { evaluateRunReadiness } from "./services/runReadinessService.js";
import { createAccountCohortStore } from "./services/accountCohortStore.js";
import { collectWorkflowParameters } from "./services/workflowParameterService.js";
import { loadConfig } from "../config.js";
import { ZoomApiClient } from "../zoom/api.js";
import { TokenManager } from "../zoom/oauth.js";
import type { SubAccount } from "../automation/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateServerOptions {
  envPath?: string;
}

export function createAutomationServer(options: CreateServerOptions = {}) {
  dotenv.config({ path: options.envPath ?? process.env.ENV_PATH ?? ".env" });

  const app = express();
  const jobEvents = createJobEventEmitter();
  const jobStore = createFileJobStore({ directory: path.resolve("output/jobs"), events: jobEvents });
  const workItemStore = createFileWorkItemStore({ directory: path.resolve("output/work-items") });
  const lifecycleStore = createFileWorkflowLifecycleStore(path.resolve("output/workflow-lifecycle.json"));
  const workflowRegistry = createWorkflowRegistry({ lifecycleStore });
  const schedulerStore = createSchedulerStore(path.resolve("output/schedules.json"));
  const cohortStore = createAccountCohortStore(path.resolve("output/cohorts"));
  const webhookService = new WebhookService();
  // Single-user tool: the most recent account-query result is cached process-wide so
  // POST /api/jobs can resolve account IDs without re-querying. Not safe for concurrent
  // multi-user use; jobs created via the scheduler resolve their own accounts independently.
  let cachedAccounts: SubAccount[] = [];

  app.use(express.json({ limit: "1mb" }));
  // PRISM_TOKENS_PATH must be set to serve design tokens. Intentionally a no-op when unset.
  if (process.env.PRISM_TOKENS_PATH) {
    app.use("/prism", express.static(process.env.PRISM_TOKENS_PATH));
  }
  const artifactsStaticDir = path.resolve(process.env.ARTIFACTS_DIR ?? "output/artifacts");
  app.use("/artifacts", express.static(artifactsStaticDir));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/workflows", (_request, response) => {
    response.json({ workflows: workflowRegistry.list() });
  });

  app.get("/api/workflows/recorded", (_request, response) => {
    const recordedDir = path.resolve("src/workflows/recorded");
    try {
      const entries = readdirSync(recordedDir).filter((entry) => {
        try { return statSync(path.join(recordedDir, entry)).isDirectory(); } catch { return false; }
      });
      const workflows = entries.map((id) => {
        try {
          const schema = JSON.parse(readFileSync(path.join(recordedDir, id, "schema.json"), "utf8"));
          return {
            id,
            name: schema.meta?.name ?? id,
            category: schema.meta?.category ?? "custom",
            actionCount: schema.actions?.length ?? 0,
            lifecycleStatus: lifecycleStore.getOrCreate(id, "recorded").status
          };
        } catch { return { id, name: id, category: "custom", actionCount: 0, lifecycleStatus: lifecycleStore.getOrCreate(id, "recorded").status }; }
      });
      response.json({ workflows });
    } catch {
      response.json({ workflows: [] });
    }
  });

  app.get("/api/workflows/recorded/:id", (request, response) => {
    try {
      const schemaPath = resolveRecordedWorkflowPath(request.params.id, "schema.json");
      const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
      response.json({ workflow: schema });
    } catch (error) {
      if (error instanceof PathTraversalError) {
        response.status(400).json({ error: error.message });
      } else {
        response.status(404).json({ error: "Recorded workflow not found" });
      }
    }
  });

  app.put("/api/workflows/recorded/:id", (request, response, next) => {
    try {
      const workflow = request.body?.workflow;
      if (!workflow) {
        response.status(400).json({ error: "workflow is required in request body" });
        return;
      }
      const validation = safeParseWorkflow(workflow);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }
      const lifecycle = lifecycleStore.getOrCreate(request.params.id, "recorded");
      if (lifecycle.status === "published") {
        response.status(409).json({ error: "Published workflows are immutable. Duplicate the workflow before editing." });
        return;
      }
      resolveRecordedWorkflowPath(request.params.id);
      const result = compileWorkflow(workflow, path.resolve("src/workflows/recorded"), request.params.id);
      lifecycleStore.getOrCreate(result.id, "recorded");
      response.json({ ok: true, compiled: result.id });
    } catch (error) {
      if (error instanceof PathTraversalError) {
        response.status(400).json({ error: (error as Error).message });
      } else {
        next(error);
      }
    }
  });

  app.post("/api/workflows/recorded/:id/duplicate", (request, response, next) => {
    try {
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      if (!name) {
        response.status(400).json({ error: "name is required" });
        return;
      }

      let source: unknown;
      try {
        source = JSON.parse(readFileSync(resolveRecordedWorkflowPath(request.params.id, "schema.json"), "utf8"));
      } catch (error) {
        if (error instanceof PathTraversalError) {
          response.status(400).json({ error: error.message });
        } else {
          response.status(404).json({ error: "Recorded workflow not found" });
        }
        return;
      }

      const candidate = {
        ...(source as Record<string, unknown>),
        meta: { ...((source as { meta?: Record<string, unknown> }).meta ?? {}), name, recordedAt: new Date().toISOString() }
      };
      const validation = safeParseWorkflow(candidate);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }

      const uniqueId = uniqueRecordedId(name);
      const result = compileWorkflow(validation.workflow, path.resolve("src/workflows/recorded"), uniqueId);
      lifecycleStore.getOrCreate(result.id, "recorded");
      response.status(201).json({ id: result.id, name });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workflows/import", (request, response, next) => {
    try {
      const body = request.body as { workflow?: RecordedWorkflow; options?: { compile?: boolean; enableImmediately?: boolean } };
      const validation = safeParseWorkflow(body.workflow);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }

      const workflow = validation.workflow;
      if (!workflow.meta.name) {
        response.status(400).json({ error: "Workflow must have a name" });
        return;
      }

      const outputBase = path.resolve("src/workflows/recorded");
      const result = compileWorkflow(workflow, outputBase);
      lifecycleStore.getOrCreate(result.id, "recorded");

      response.status(201).json({
        id: result.id,
        outputDir: result.outputDir,
        warnings: result.warnings,
        testResults: result.testResults,
        message: `Workflow "${workflow.meta.name}" compiled to ${result.outputDir}. Add it to src/workflows/index.ts to enable.`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/address-profiles", (_request, response) => {
    const config = loadConfig(process.env);
    const profilesPath = process.env.ADDRESS_PROFILES_PATH ?? "addresses.yaml";
    const profiles = listAddressProfiles(profilesPath).map(({ id, profile }) => ({
      id,
      country: profile.country,
      numberType: profile.numberType ?? "Toll",
      customerName: profile.customerName,
      address: profile.address,
      documentsRequired: profile.documents?.required ?? true
    }));
    response.json({
      selectedProfile: process.env.ADDRESS_PROFILE ?? "australia_sydney",
      adminEmail: config.zoom.adminEmail,
      profiles
    });
  });

  app.post("/api/workflows/:id/lifecycle", (request, response) => {
    const status = request.body?.status as WorkflowLifecycleStatus | undefined;
    if (!status) {
      response.status(400).json({ error: "status is required" });
      return;
    }
    try {
      const current = lifecycleStore.getOrCreate(request.params.id, "recorded");
      if (current.status === status) {
        response.json({ lifecycle: current });
        return;
      }
      const lifecycle = lifecycleStore.transition(request.params.id, status, {
        actor: typeof request.body?.actor === "string" ? request.body.actor : "web-ui",
        note: typeof request.body?.note === "string" ? request.body.note : undefined
      });
      response.json({ lifecycle });
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/readiness/check", (request, response, next) => {
    try {
      const body = request.body as {
        accounts?: SubAccount[];
        workflowIds?: string[];
        addressProfile?: string;
        dryRun?: boolean;
        parameterValues?: Record<string, string>;
      };
      const config = loadConfig({ ...process.env, ADDRESS_PROFILE: body.addressProfile ?? process.env.ADDRESS_PROFILE });
      const enabledWorkflowIds = new Set(workflowRegistry.list().filter((workflow) => workflow.enabled).map((workflow) => workflow.id));
      const workflows = workflowRegistry.list();
      const selectedWorkflowParameters = collectWorkflowParameters(
        workflows.filter((workflow) => (body.workflowIds ?? []).includes(workflow.id))
      );
      const result = evaluateRunReadiness({
        selectedAccounts: body.accounts ?? [],
        workflowIds: body.workflowIds ?? [],
        enabledWorkflowIds,
        workflows,
        addressProfile: body.addressProfile,
        dryRun: body.dryRun ?? true,
        requiredDocuments: [
          { label: "ID document", path: config.documents.idPath, required: config.documents.required },
          { label: "Business verification", path: config.documents.businessVerificationPath, required: config.documents.required }
        ],
        parameters: selectedWorkflowParameters,
        parameterValues: body.parameterValues ?? {}
      });
      response.json({ readiness: result });
    } catch (error) {
      next(error);
    }
  });

  const serverTokenManager = new TokenManager(loadConfig(process.env).zoom);

  /** Query Zoom for sub accounts and apply selection filters. */
  async function resolveAccounts(filters: AccountSelectionFilters): Promise<SubAccount[]> {
    const config = loadConfig(process.env);
    const client = new ZoomApiClient({ accessToken: serverTokenManager, baseUrl: config.zoom.apiBaseUrl });
    const all = await client.listSubAccounts();
    return filterSelectableAccounts(all, filters);
  }

  /** Dispatch webhooks once a job reaches a terminal state. */
  function watchJobForWebhooks(jobId: string): void {
    const unsubscribe = jobEvents.subscribe(jobId, (job) => {
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        unsubscribe();
        void webhookService.notifyJobComplete(job).catch(() => undefined);
      }
    });
  }

  function unsafeLiveWorkflows(workflowIds: string[], dryRun: boolean): Array<{ id: string; name: string }> {
    if (dryRun) return [];
    const byId = new Map(workflowRegistry.list().map((workflow) => [workflow.id, workflow]));
    return workflowIds
      .map((workflowId) => byId.get(workflowId))
      .filter((workflow): workflow is NonNullable<typeof workflow> => Boolean(workflow))
      .filter((workflow) => !isLifecycleLiveRunnable(workflow.lifecycleStatus))
      .map((workflow) => ({ id: workflow.id, name: workflow.name }));
  }

  /** Resolve accounts for a schedule, create + start a job, and record the run. */
  async function triggerScheduledRun(schedule: ScheduleDefinition): Promise<string | undefined> {
    const accounts = await resolveAccounts(schedule.jobConfig.accountFilters ?? {});
    if (accounts.length === 0) {
      schedulerStore.markRun(schedule.id, "failed");
      return undefined;
    }
    const unsafeWorkflows = unsafeLiveWorkflows(schedule.jobConfig.workflowIds, schedule.jobConfig.dryRun);
    if (unsafeWorkflows.length > 0) {
      schedulerStore.markRun(schedule.id, "failed");
      return undefined;
    }
    const job = jobStore.createJob({
      accountIds: accounts.map((account) => account.id),
      workflowIds: schedule.jobConfig.workflowIds,
      dryRun: schedule.jobConfig.dryRun,
      addressProfile: schedule.jobConfig.addressProfile
    });
    watchJobForWebhooks(job.id);
    // Record the schedule's final run status when the job finishes.
    const unsubscribe = jobEvents.subscribe(job.id, (updated) => {
      if (["completed", "failed", "cancelled"].includes(updated.status)) {
        unsubscribe();
        schedulerStore.markRun(schedule.id, updated.status as ScheduleDefinition["lastRunStatus"]);
      }
    });
    startAutomationJob({
      jobId: job.id,
      accounts,
      workflowIds: schedule.jobConfig.workflowIds,
      addressProfile: schedule.jobConfig.addressProfile,
      dryRun: schedule.jobConfig.dryRun,
      headless: schedule.jobConfig.headless,
      retryAttempts: schedule.jobConfig.retryAttempts,
      retryBaseDelayMs: schedule.jobConfig.retryBaseDelayMs,
      accountDelayMs: schedule.jobConfig.accountDelayMs,
      concurrency: Math.min(schedule.jobConfig.concurrency ?? 1, 10),
      store: jobStore,
      workItemStore,
      registry: workflowRegistry
    });
    return job.id;
  }

  app.post("/api/accounts/query", async (request, response, next) => {
    try {
      const filters = request.body?.filters as AccountSelectionFilters | undefined;
      const config = loadConfig(process.env);
      const client = new ZoomApiClient({
        accessToken: serverTokenManager,
        baseUrl: config.zoom.apiBaseUrl
      });
      cachedAccounts = await client.listSubAccounts();
      const accounts = filterSelectableAccounts(cachedAccounts, filters ?? {});
      response.json({
        total: cachedAccounts.length,
        count: accounts.length,
        accounts
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cohorts", (_request, response) => {
    response.json({ cohorts: cohortStore.list() });
  });

  app.post("/api/cohorts", (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const accountIds = Array.isArray(request.body?.accountIds) ? request.body.accountIds : [];
    if (!name || accountIds.length === 0) {
      response.status(400).json({ error: "name and accountIds are required" });
      return;
    }
    const cohort = cohortStore.create({ name, accountIds, filters: request.body?.filters });
    response.status(201).json({ cohort });
  });

  app.put("/api/cohorts/:id", (request, response, next) => {
    try {
      response.json({ cohort: cohortStore.update(request.params.id, request.body) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cohorts/:id", (request, response) => {
    const deleted = cohortStore.delete(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Cohort not found" });
      return;
    }
    response.json({ ok: true });
  });

  app.get("/api/jobs", (_request, response) => {
    response.json({ jobs: jobStore.listJobs() });
  });

  app.get("/api/jobs/:jobId", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json({ job });
  });

  app.get("/api/jobs/:jobId/work-items", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json({ workItems: workItemStore.listWorkItems({ jobId: job.id }) });
  });

  app.get("/api/jobs/:jobId/export", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    const format = (request.query.format as string) ?? "json";
    if (format === "csv") {
      const rows = ["Account ID,Status,Workflow,Message,Error"];
      for (const account of job.accounts) {
        rows.push([
          account.accountId,
          account.status,
          account.workflowId ?? "",
          csvEscape(account.message ?? ""),
          csvEscape(account.error ?? "")
        ].join(","));
      }
      response.setHeader("Content-Type", "text/csv");
      response.setHeader("Content-Disposition", `attachment; filename="job-${job.id.slice(0, 8)}-results.csv"`);
      response.send(rows.join("\n"));
    } else {
      response.setHeader("Content-Disposition", `attachment; filename="job-${job.id.slice(0, 8)}-results.json"`);
      response.json({ job });
    }
  });

  app.get("/api/jobs/:jobId/artifacts", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    const config = loadConfig(process.env);
    const accountId = typeof request.query.accountId === "string" ? request.query.accountId : undefined;
    const artifacts = listJobArtifacts({
      artifactsDir: path.resolve(config.runtime.artifactsDir),
      job,
      accountId
    });
    response.json({ artifacts });
  });

  app.get("/api/jobs/:jobId/stream", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const isTerminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);

    // Heartbeat comment frame keeps idle proxies from dropping the connection.
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25_000);

    let unsubscribe = () => undefined as void;
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    // Send current state immediately
    response.write(`data: ${JSON.stringify({ job })}\n\n`);

    // If the job is already finished, send it and close instead of holding the socket open.
    if (isTerminal(job.status)) {
      cleanup();
      response.end();
      return;
    }

    // Subscribe to future updates; close the stream once the job finishes.
    unsubscribe = jobEvents.subscribe(request.params.jobId, (updatedJob) => {
      response.write(`data: ${JSON.stringify({ job: updatedJob })}\n\n`);
      if (isTerminal(updatedJob.status)) {
        cleanup();
        response.end();
      }
    });

    // Clean up on client disconnect
    request.on("close", cleanup);
  });

  app.post("/api/jobs/:jobId/cancel", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }

    if (!["queued", "running"].includes(job.status)) {
      response.json({ job, message: "Job is already finished" });
      return;
    }

    const wasCancelled = cancelRunningJob(request.params.jobId);
    for (const item of workItemStore.listWorkItems({ jobId: request.params.jobId })) {
      if (!["succeeded", "skipped", "failed", "abandoned", "cancelled"].includes(item.status)) {
        workItemStore.markCancelled(item.id, "Cancelled by user");
      }
    }
    const updatedJob = jobStore.markJob(request.params.jobId, "cancelled", "Cancelled by user");
    response.json({ job: updatedJob, message: wasCancelled ? "Cancellation signalled" : "Job marked cancelled" });
  });

  app.post("/api/jobs/:jobId/retry", (request, response, next) => {
    try {
      const sourceJob = jobStore.getJob(request.params.jobId);
      if (!sourceJob) {
        response.status(404).json({ error: "Job not found" });
        return;
      }
      const statuses = Array.isArray(request.body?.statuses) ? request.body.statuses : ["failed"];
      const accountIds = selectRetryAccounts(sourceJob, { statuses });
      if (accountIds.length === 0) {
        response.status(409).json({ error: "No matching accounts to retry" });
        return;
      }

      const sourceAccounts = Array.isArray(request.body?.accounts) && request.body.accounts.length > 0
        ? request.body.accounts as SubAccount[]
        : cachedAccounts;
      const selectedAccounts = sourceAccounts.filter((account) => accountIds.includes(account.id));
      if (selectedAccounts.length !== accountIds.length) {
        response.status(409).json({ error: "Retry accounts are not available in the current account cache. Query accounts again first." });
        return;
      }

      const retryInput = createRetryJobInput(sourceJob, accountIds);
      const retryDryRun = request.body?.dryRun ?? retryInput.dryRun;
      const retryWorkflowIds = retryInput.workflowIds;
      const unsafeWorkflows = unsafeLiveWorkflows(retryWorkflowIds, retryDryRun);
      if (unsafeWorkflows.length > 0) {
        response.status(409).json({ error: `Live runs require approved or published workflows: ${unsafeWorkflows.map((workflow) => workflow.name).join(", ")}` });
        return;
      }
      const job = jobStore.createJob({
        ...retryInput,
        dryRun: retryDryRun,
        addressProfile: request.body?.addressProfile ?? retryInput.addressProfile
      });
      startAutomationJob({
        jobId: job.id,
        accounts: selectedAccounts,
        workflowIds: job.input.workflowIds,
        addressProfile: job.input.addressProfile,
        dryRun: job.input.dryRun,
        headless: request.body?.headless ?? true,
        retryAttempts: request.body?.retryAttempts ?? 2,
        retryBaseDelayMs: request.body?.retryBaseDelayMs ?? 5_000,
        accountDelayMs: request.body?.accountDelayMs ?? 2_000,
        concurrency: Math.min(request.body?.concurrency ?? 1, 10),
        store: jobStore,
        workItemStore,
        registry: workflowRegistry
      });
      watchJobForWebhooks(job.id);
      response.status(201).json({ job });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/jobs", (request, response, next) => {
    try {
      const body = request.body as {
        accountIds?: string[];
        accounts?: SubAccount[];
        workflowIds?: string[];
        dryRun?: boolean;
        headless?: boolean;
        addressProfile?: string;
        retryAttempts?: number;
        retryBaseDelayMs?: number;
        accountDelayMs?: number;
        concurrency?: number;
        accountValues?: Record<string, Record<string, string>>;
      };
      const accountIds = body.accountIds ?? [];
      const sourceAccounts = body.accounts && body.accounts.length > 0 ? body.accounts : cachedAccounts;
      const selectedAccounts = sourceAccounts.filter((account) => accountIds.includes(account.id));
      if (selectedAccounts.length === 0) {
        response.status(400).json({ error: "Select at least one sub account before starting a job" });
        return;
      }

      const workflowIds = body.workflowIds ?? ["add-business-address"];
      if (workflowIds.length === 0) {
        response.status(400).json({ error: "Select at least one workflow" });
        return;
      }
      for (const workflowId of workflowIds) {
        try {
          workflowRegistry.getEnabled(workflowId);
        } catch {
          response.status(400).json({ error: `Unknown or disabled workflow: ${workflowId}` });
          return;
        }
      }

      const unsafeWorkflows = unsafeLiveWorkflows(workflowIds, body.dryRun ?? true);
      if (unsafeWorkflows.length > 0) {
        response.status(409).json({ error: `Live runs require approved or published workflows: ${unsafeWorkflows.map((workflow) => workflow.name).join(", ")}` });
        return;
      }

      const job = jobStore.createJob({
        accountIds: selectedAccounts.map((account) => account.id),
        workflowIds,
        dryRun: body.dryRun ?? true,
        addressProfile: body.addressProfile ?? process.env.ADDRESS_PROFILE ?? "australia_sydney"
      });

      startAutomationJob({
        jobId: job.id,
        accounts: selectedAccounts,
        workflowIds,
        addressProfile: job.input.addressProfile,
        dryRun: job.input.dryRun,
        headless: body.headless ?? true,
        retryAttempts: body.retryAttempts ?? 2,
        retryBaseDelayMs: body.retryBaseDelayMs ?? 5_000,
        accountDelayMs: body.accountDelayMs ?? 2_000,
        concurrency: Math.min(body.concurrency ?? 1, 10),
        accountValues: body.accountValues,
        store: jobStore,
        workItemStore,
        registry: workflowRegistry
      });
      watchJobForWebhooks(job.id);

      response.status(201).json({ job });
    } catch (error) {
      next(error);
    }
  });

  // ─── Scheduler Endpoints ──────────────────────────────────────────────────

  app.get("/api/schedules", (_request, response) => {
    response.json({ schedules: schedulerStore.list() });
  });

  app.get("/api/schedules/:id", (request, response) => {
    const schedule = schedulerStore.get(request.params.id);
    if (!schedule) {
      response.status(404).json({ error: "Schedule not found" });
      return;
    }
    response.json({ schedule });
  });

  app.post("/api/schedules", (request, response, next) => {
    try {
      const body = request.body as Partial<ScheduleDefinition>;
      if (!body.name || !body.cron || !body.jobConfig) {
        response.status(400).json({ error: "name, cron, and jobConfig are required" });
        return;
      }
      const schedule = schedulerStore.create({
        name: body.name,
        cron: body.cron,
        enabled: body.enabled ?? true,
        jobConfig: body.jobConfig,
        notifications: body.notifications
      });
      response.status(201).json({ schedule });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/schedules/:id", (request, response, next) => {
    try {
      const schedule = schedulerStore.update(request.params.id, request.body);
      response.json({ schedule });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/schedules/:id", (request, response) => {
    const deleted = schedulerStore.delete(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Schedule not found" });
      return;
    }
    response.json({ ok: true });
  });

  app.post("/api/schedules/:id/run", async (request, response, next) => {
    const schedule = schedulerStore.get(request.params.id);
    if (!schedule) {
      response.status(404).json({ error: "Schedule not found" });
      return;
    }
    try {
      const jobId = await triggerScheduledRun(schedule);
      if (!jobId) {
        response.status(409).json({ error: "No accounts matched the schedule's filters", scheduleId: schedule.id });
        return;
      }
      response.json({ message: "Schedule run started", scheduleId: schedule.id, jobId });
    } catch (error) {
      next(error);
    }
  });

  // ─── Dashboard & Analytics ─────────────────────────────────────────────────

  app.get("/api/dashboard", (_request, response) => {
    const jobs = jobStore.listJobs();
    const metrics = computeDashboardMetrics(jobs);
    response.json(metrics);
  });

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  app.get("/api/webhooks", (_request, response) => {
    response.json({ webhooks: webhookService.listWebhooks() });
  });

  app.get("/api/webhooks/deliveries", (_request, response) => {
    response.json({ deliveries: webhookService.getDeliveryLog() });
  });

  app.post("/api/webhooks", async (request, response, next) => {
    const body = request.body;
    if (!body.name || !body.url || !body.events) {
      response.status(400).json({ error: "name, url, and events are required" });
      return;
    }
    try {
      if (!(await isAllowedWebhookUrl(body.url))) {
        response.status(400).json({ error: "Webhook URL must use https: and resolve to a public host" });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
    const config = {
      id: `wh_${Date.now().toString(36)}`,
      name: body.name,
      url: body.url,
      events: body.events,
      enabled: body.enabled ?? true,
      secret: body.secret,
      maxRetries: body.maxRetries ?? 3,
      headers: body.headers
    };
    webhookService.addWebhook(config);
    response.status(201).json({ webhook: config });
  });

  app.delete("/api/webhooks/:id", (request, response) => {
    webhookService.removeWebhook(request.params.id);
    response.json({ ok: true });
  });

  // ─── Rate Limiter Stats ───────────────────────────────────────────────────

  app.get("/api/system/health", (_request, response) => {
    response.json({
      status: "ok",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      schedules: schedulerStore.list().filter((s) => s.enabled).length,
      activeJobs: jobStore.listJobs().filter((j) => j.status === "running").length
    });
  });

  // ─── Error Handler ────────────────────────────────────────────────────────

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    response.status(500).json({ error: normalizedError.message });
  });

  // ─── Scheduler tick loop ───────────────────────────────────────────────────
  // Every minute, run any enabled schedule whose cron matches now. The
  // per-minute guard prevents a schedule from firing twice within one minute.
  // Disabled by default in tests via DISABLE_SCHEDULER to avoid background work.
  if (process.env.DISABLE_SCHEDULER !== "true") {
    const firedThisMinute = new Set<string>();
    const tick = () => {
      const now = new Date();
      const minuteKey = Math.floor(now.getTime() / 60_000);
      for (const schedule of schedulerStore.list()) {
        if (!schedule.enabled) continue;
        if (!shouldRunNow(schedule.cron, now)) continue;
        const guardKey = `${schedule.id}:${minuteKey}`;
        if (firedThisMinute.has(guardKey)) continue;
        firedThisMinute.add(guardKey);
        void triggerScheduledRun(schedule).catch(() => undefined);
      }
      // Keep the guard set from growing unbounded.
      if (firedThisMinute.size > 500) firedThisMinute.clear();
    };
    const timer = setInterval(tick, 60_000);
    // Don't keep the process (or tests) alive solely for the scheduler.
    timer.unref?.();
  }

  return app;
}

export function resolveBuiltUiPath(): string {
  return path.resolve(__dirname, "../../dist/ui");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

class PathTraversalError extends Error {}

const RECORDED_WORKFLOW_BASE = path.resolve("src/workflows/recorded");

/** Derive a recorded-workflow id from a name, bumping a numeric suffix to avoid collisions. */
function uniqueRecordedId(name: string): string {
  const base = slugify(name) || `recorded-${Date.now()}`;
  let candidate = base;
  let counter = 2;
  while (statSyncExists(path.join(RECORDED_WORKFLOW_BASE, candidate))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function statSyncExists(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a path inside the recorded-workflow directory and throw if the
 * result escapes that directory (path traversal guard).
 */
function resolveRecordedWorkflowPath(id: string, ...segments: string[]): string {
  const resolved = path.resolve(RECORDED_WORKFLOW_BASE, id, ...segments);
  if (!resolved.startsWith(RECORDED_WORKFLOW_BASE + path.sep) && resolved !== RECORDED_WORKFLOW_BASE) {
    throw new PathTraversalError(`Invalid workflow id: "${id}"`);
  }
  return resolved;
}
