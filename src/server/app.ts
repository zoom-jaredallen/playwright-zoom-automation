import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createFileWorkflowLifecycleStore,
  isLifecycleLiveRunnable,
} from "./governance/workflowLifecycle.js";
import { createFileAuditStore } from "./audit/auditStore.js";
import { filterSelectableAccounts, type AccountSelectionFilters } from "./services/accountSelectionService.js";
import { createFileJobStore } from "./services/fileJobStore.js";
import { createFileWorkItemStore } from "./queues/fileWorkItemStore.js";
import { createJobEventEmitter } from "./services/jobEvents.js";
import { cancelRunningJob, startAutomationJob } from "./services/jobRunner.js";
import { createRetryJobInput, selectRetryAccounts } from "./services/jobRetryService.js";
import { listJobArtifacts } from "./services/artifacts.js";
import { buildRunCockpit } from "./services/runCockpitService.js";
import { createSchedulerStore, shouldRunNow, type ScheduleDefinition } from "./services/scheduler.js";
import { WebhookService } from "./services/webhooks.js";
import { createWorkflowRegistry } from "./services/workflowRegistry.js";
import { createAccountCohortStore } from "./services/accountCohortStore.js";
import { createRunManifest } from "./operations/reportExporter.js";
import { createFileWorkerRegistry } from "./workers/fileWorkerRegistry.js";
import { createRecorderDebugStore } from "./services/recorderDebugStore.js";
import { registerRecorderDebugRoutes } from "./routes/recorderDebugRoutes.js";
import { registerWorkflowRoutes } from "./routes/workflowRoutes.js";
import { registerOperationsRoutes } from "./routes/operationsRoutes.js";
import { csvEscape, resolveBuiltUiPath as resolveBuiltUiPathFromDir } from "./serverPaths.js";
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
  const auditStore = createFileAuditStore(path.resolve("output/audit/audit.jsonl"));
  const workerRegistry = createFileWorkerRegistry(path.resolve("output/workers.json"));
  const workflowRegistry = createWorkflowRegistry({ lifecycleStore });
  const schedulerStore = createSchedulerStore(path.resolve("output/schedules.json"));
  const cohortStore = createAccountCohortStore(path.resolve("output/cohorts"));
  const recorderDebugStore = createRecorderDebugStore({
    directory: path.resolve(process.env.RECORDER_DEBUG_DIR ?? "output/recorder-sessions")
  });
  const webhookService = new WebhookService();
  // Single-user cache used by POST /api/jobs after the latest account query.
  let cachedAccounts: SubAccount[] = [];

  app.use(express.json({ limit: "15mb" }));
  if (process.env.PRISM_TOKENS_PATH) {
    app.use("/prism", express.static(process.env.PRISM_TOKENS_PATH));
  }
  const artifactsStaticDir = path.resolve(process.env.ARTIFACTS_DIR ?? "output/artifacts");
  app.use("/artifacts", express.static(artifactsStaticDir));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  registerRecorderDebugRoutes(app, recorderDebugStore);

  registerWorkflowRoutes(app, { lifecycleStore, auditStore, workflowRegistry });

  const serverTokenManager = new TokenManager(loadConfig(process.env).zoom);

  async function resolveAccounts(filters: AccountSelectionFilters): Promise<SubAccount[]> {
    const config = loadConfig(process.env);
    const client = new ZoomApiClient({ accessToken: serverTokenManager, baseUrl: config.zoom.apiBaseUrl });
    const all = await client.listSubAccounts();
    return filterSelectableAccounts(all, filters);
  }

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
    if (!job.input.dryRun) {
      auditStore.append({ eventType: "live_run_started", actor: "scheduler", jobId: job.id, message: "Scheduled live run started" });
    }
    watchJobForWebhooks(job.id);
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

  app.get("/api/jobs/:jobId/cockpit", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json({ cockpit: buildRunCockpit(job) });
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

  app.get("/api/jobs/:jobId/manifest", (request, response) => {
    const job = jobStore.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    const config = loadConfig(process.env);
    const artifacts = listJobArtifacts({ artifactsDir: path.resolve(config.runtime.artifactsDir), job });
    const workItems = workItemStore.listWorkItems({ jobId: job.id });
    response.json({ manifest: createRunManifest({ job, workItems, artifacts }) });
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

    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25_000);

    let unsubscribe = () => undefined as void;
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    response.write(`data: ${JSON.stringify({ job })}\n\n`);

    if (isTerminal(job.status)) {
      cleanup();
      response.end();
      return;
    }

    unsubscribe = jobEvents.subscribe(request.params.jobId, (updatedJob) => {
      response.write(`data: ${JSON.stringify({ job: updatedJob })}\n\n`);
      if (isTerminal(updatedJob.status)) {
        cleanup();
        response.end();
      }
    });

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
    auditStore.append({ eventType: "run_cancelled", actor: "web-ui", jobId: request.params.jobId, message: "Run cancelled" });
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
      auditStore.append({
        eventType: "work_item_retried",
        actor: "web-ui",
        jobId: job.id,
        message: "Retry job created",
        metadata: { sourceJobId: sourceJob.id, accountIds }
      });
      if (!job.input.dryRun) {
        auditStore.append({ eventType: "live_run_started", actor: "web-ui", jobId: job.id, message: "Live retry run started" });
      }
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
      if (!job.input.dryRun) {
        auditStore.append({ eventType: "live_run_started", actor: "web-ui", jobId: job.id, message: "Live run started" });
      }

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

  registerOperationsRoutes(app, { auditStore, jobStore, schedulerStore, webhookService, workerRegistry, workItemStore });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    response.status(500).json({ error: normalizedError.message });
  });

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
      if (firedThisMinute.size > 500) firedThisMinute.clear();
    };
    const timer = setInterval(tick, 60_000);
    timer.unref?.();
  }

  return app;
}

export function resolveBuiltUiPath(): string { return resolveBuiltUiPathFromDir(__dirname); }
