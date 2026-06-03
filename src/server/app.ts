import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { listAddressProfiles } from "../addressProfiles.js";
import { compileWorkflow } from "../compiler/compiler.js";
import type { RecordedWorkflow } from "../compiler/types.js";
import { filterSelectableAccounts, type AccountSelectionFilters } from "./services/accountSelectionService.js";
import { createFileJobStore } from "./services/fileJobStore.js";
import { createJobEventEmitter } from "./services/jobEvents.js";
import { cancelRunningJob, startAutomationJob } from "./services/jobRunner.js";
import { computeDashboardMetrics } from "./services/analytics.js";
import { listJobArtifacts } from "./services/artifacts.js";
import { createSchedulerStore, type ScheduleDefinition } from "./services/scheduler.js";
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
  let cachedAccounts: SubAccount[] = [];

  app.use(express.json({ limit: "1mb" }));
  app.use("/prism", express.static("/Users/jaredallen/.codex/skills/prism-design/tokens"));
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
      const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
      const entries = readdirSync(recordedDir).filter((entry: string) => {
        try { return statSync(path.join(recordedDir, entry)).isDirectory(); } catch { return false; }
      });
      const workflows = entries.map((id: string) => {
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
    const schemaPath = path.resolve("src/workflows/recorded", request.params.id, "schema.json");
    try {
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
      response.json({ workflow: schema });
    } catch {
      response.status(404).json({ error: "Recorded workflow not found" });
    }
  });

  app.put("/api/workflows/recorded/:id", (request, response, next) => {
    try {
      const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
      const workflow = request.body?.workflow;
      if (!workflow) {
        response.status(400).json({ error: "workflow is required in request body" });
        return;
      }
      const dir = path.resolve("src/workflows/recorded", request.params.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "schema.json"), JSON.stringify(workflow, null, 2) + "\n", "utf8");
      // Re-compile
      const result = compileWorkflow(workflow, path.resolve("src/workflows/recorded"));
      response.json({ ok: true, compiled: result.id });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workflows/import", (request, response, next) => {
    try {
      const body = request.body as { workflow?: RecordedWorkflow; options?: { compile?: boolean; enableImmediately?: boolean } };
      if (!body.workflow || !body.workflow.version || !body.workflow.actions) {
        response.status(400).json({ error: "Invalid workflow JSON — missing version or actions" });
        return;
      }

      const workflow = body.workflow;
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

    // Send current state immediately
    response.write(`data: ${JSON.stringify({ job })}\n\n`);

    // Subscribe to future updates
    const unsubscribe = jobEvents.subscribe(request.params.jobId, (updatedJob) => {
      response.write(`data: ${JSON.stringify({ job: updatedJob })}\n\n`);
    });

    // Clean up on client disconnect
    request.on("close", () => {
      unsubscribe();
    });
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
        workflowRegistry.getEnabled(workflowId);
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
        concurrency: body.concurrency ?? 1,
        store: jobStore,
        registry: workflowRegistry
      });

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

  app.post("/api/schedules/:id/run", (request, response) => {
    const schedule = schedulerStore.get(request.params.id);
    if (!schedule) {
      response.status(404).json({ error: "Schedule not found" });
      return;
    }
    response.json({ message: "Manual trigger queued", scheduleId: schedule.id });
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
