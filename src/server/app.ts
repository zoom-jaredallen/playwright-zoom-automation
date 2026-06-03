import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { listAddressProfiles } from "../addressProfiles.js";
import { filterSelectableAccounts, type AccountSelectionFilters } from "./services/accountSelectionService.js";
import { createFileJobStore } from "./services/fileJobStore.js";
import { createJobEventEmitter } from "./services/jobEvents.js";
import { cancelRunningJob, startAutomationJob } from "./services/jobRunner.js";
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
      if (workflowIds.length !== 1) {
        response.status(400).json({ error: "Run one workflow at a time in this release" });
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

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    response.status(500).json({ error: normalizedError.message });
  });

  return app;
}

export function resolveBuiltUiPath(): string {
  return path.resolve(__dirname, "../../dist/ui");
}
