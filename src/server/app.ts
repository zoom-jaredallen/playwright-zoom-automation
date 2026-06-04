import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import dotenv from "dotenv";
import { listAddressProfiles } from "../addressProfiles.js";
import { compileWorkflow, slugify } from "../compiler/compiler.js";
import type { RecordedWorkflow } from "../compiler/types.js";
import { safeParseWorkflow } from "@zoom-automation/workflow-core";
import { filterSelectableAccounts, type AccountSelectionFilters } from "./services/accountSelectionService.js";
import { createFileJobStore } from "./services/fileJobStore.js";
import { createJobEventEmitter } from "./services/jobEvents.js";
import { cancelRunningJob, startAutomationJob } from "./services/jobRunner.js";
import { computeDashboardMetrics } from "./services/analytics.js";
import { listJobArtifacts } from "./services/artifacts.js";
import { createSchedulerStore, shouldRunNow, type ScheduleDefinition } from "./services/scheduler.js";
import { WebhookService } from "./services/webhooks.js";
import { createWorkflowRegistry } from "./services/workflowRegistry.js";
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
  const workflowRegistry = createWorkflowRegistry();
  const schedulerStore = createSchedulerStore(path.resolve("output/schedules.json"));
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
  app.use("/artifacts", express.static(path.resolve("output")));

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
          return { id, name: schema.meta?.name ?? id, category: schema.meta?.category ?? "custom", actionCount: schema.actions?.length ?? 0 };
        } catch { return { id, name: id, category: "custom", actionCount: 0 }; }
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
      const dir = resolveRecordedWorkflowPath(request.params.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "schema.json"), JSON.stringify(workflow, null, 2) + "\n", "utf8");
      const result = compileWorkflow(workflow, path.resolve("src/workflows/recorded"));
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

  /** Resolve accounts for a schedule, create + start a job, and record the run. */
  async function triggerScheduledRun(schedule: ScheduleDefinition): Promise<string | undefined> {
    const accounts = await resolveAccounts(schedule.jobConfig.accountFilters ?? {});
    if (accounts.length === 0) {
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
      outputRoot: path.resolve("output"),
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
    const updatedJob = jobStore.markJob(request.params.jobId, "cancelled", "Cancelled by user");
    response.json({ job: updatedJob, message: wasCancelled ? "Cancellation signalled" : "Job marked cancelled" });
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
        store: jobStore,
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

  app.post("/api/webhooks", (request, response) => {
    const body = request.body;
    if (!body.name || !body.url || !body.events) {
      response.status(400).json({ error: "name, url, and events are required" });
      return;
    }
    if (!isAllowedWebhookUrl(body.url)) {
      response.status(400).json({ error: "Webhook URL must use https: and resolve to a public host" });
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

// RFC-1918 and link-local prefixes that must not receive webhook deliveries.
const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/**
 * Return true only if the URL is a syntactically valid https URL pointing to a
 * non-private host. Set ALLOW_PRIVATE_WEBHOOK_URLS=true to skip the host check
 * (useful when the webhook target is an internal test server).
 */
function isAllowedWebhookUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  if (process.env.ALLOW_PRIVATE_WEBHOOK_URLS === "true") {
    return true;
  }
  const hostname = parsed.hostname;
  if (hostname === "localhost") return false;
  if (hostname.endsWith(".internal")) return false;
  if (PRIVATE_RANGES.some((re) => re.test(hostname))) return false;
  return true;
}
