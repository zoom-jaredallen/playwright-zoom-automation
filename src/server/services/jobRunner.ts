import { chromium } from "playwright";
import type { ProgressAdapter, SubAccount } from "../../automation/types.js";
import { AutomationRunner } from "../../automation/runner.js";
import { loadConfig } from "../../config.js";
import { createLogger, parseLogLevel } from "../../logger.js";
import { validateDocumentFiles } from "../../preflight.js";
import { loginAsMasterAdmin } from "../../zoom/auth.js";
import type { JobStore } from "./inMemoryJobStore.js";
import type { WorkflowRegistry } from "./workflowRegistry.js";

export interface StartJobOptions {
  jobId: string;
  accounts: SubAccount[];
  workflowIds: string[];
  addressProfile: string;
  dryRun: boolean;
  headless: boolean;
  retryAttempts: number;
  retryBaseDelayMs: number;
  accountDelayMs: number;
  concurrency?: number;
  store: JobStore;
  registry: WorkflowRegistry;
  env?: NodeJS.ProcessEnv;
  cancellation?: { cancelled: boolean };
}

/** Map of active job cancellation tokens, keyed by job ID. */
const activeJobCancellations = new Map<string, { cancelled: boolean }>();

export function startAutomationJob(options: StartJobOptions): void {
  const cancellation = options.cancellation ?? { cancelled: false };
  activeJobCancellations.set(options.jobId, cancellation);

  void runAutomationJob({ ...options, cancellation }).catch((error) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    options.store.markJob(options.jobId, "failed", normalizedError.message);
  }).finally(() => {
    activeJobCancellations.delete(options.jobId);
  });
}

/**
 * Cancel a running job by setting its cancellation token.
 * Returns true if the job was actively running and cancellation was signalled.
 */
export function cancelRunningJob(jobId: string): boolean {
  const cancellation = activeJobCancellations.get(jobId);
  if (!cancellation) {
    return false;
  }
  cancellation.cancelled = true;
  return true;
}

async function runAutomationJob(options: StartJobOptions): Promise<void> {
  const workflows = options.workflowIds.map((id) => options.registry.getEnabled(id));
  const config = loadConfig({
    ...(options.env ?? process.env),
    ADDRESS_PROFILE: options.addressProfile,
    DRY_RUN: String(options.dryRun),
    HEADLESS: String(options.headless),
    FLOW_RETRY_ATTEMPTS: String(options.retryAttempts),
    FLOW_RETRY_BASE_DELAY_MS: String(options.retryBaseDelayMs),
    ACCOUNT_DELAY_MS: String(options.accountDelayMs)
  });

  if (!config.runtime.dryRun) {
    await validateDocumentFiles(config.documents);
  }

  const logger = createLogger({
    level: parseLogLevel(process.env.LOG_LEVEL),
    filePath: `${config.runtime.artifactsDir}/logs/job-${options.jobId}.jsonl`,
    baseMeta: { jobId: options.jobId, workflows: options.workflowIds }
  });

  const pipelineLabel = workflows.map((w) => w.name).join(" → ");
  options.store.markJob(options.jobId, "running", `Running: ${pipelineLabel}`);

  const browser = await chromium.launch({ headless: options.headless });
  try {
    const masterStorageState = await loginAsMasterAdmin({
      browser,
      config: config.zoom,
      logger
    });

    let totalCompleted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const workflow of workflows) {
      if (options.cancellation?.cancelled) break;

      logger.info(`Starting pipeline step: ${workflow.name}`, { workflowId: workflow.id });
      options.store.markJob(options.jobId, "running", `Running step: ${workflow.name}`);

      const flow = options.registry.createFlow(workflow.id, {
        browser,
        masterStorageState,
        config,
        logger
      });
      const runner = new AutomationRunner({
        flow,
        progress: createJobProgressAdapter(options.store, options.jobId, workflow.id),
        retry: {
          attempts: options.retryAttempts,
          baseDelayMs: options.retryBaseDelayMs
        },
        accountDelayMs: options.accountDelayMs,
        concurrency: options.concurrency ?? 1,
        cancellation: options.cancellation
      });

      const summary = await runner.run(options.accounts);
      totalCompleted += summary.completed;
      totalSkipped += summary.skipped;
      totalFailed += summary.failed;
    }

    const finalStatus = totalFailed > 0 ? "failed" : "completed";
    options.store.markJob(
      options.jobId,
      finalStatus,
      `Finished pipeline (${pipelineLabel}): ${totalCompleted} completed, ${totalSkipped} skipped, ${totalFailed} failed`
    );
  } finally {
    await browser.close();
  }
}

function createJobProgressAdapter(store: JobStore, jobId: string, workflowId: string): ProgressAdapter {
  return {
    shouldSkip: async () => false,
    markRunning: async (account) => {
      store.markAccount(jobId, account.id, { status: "running", workflowId });
    },
    markCompleted: async (account, message) => {
      store.markAccount(jobId, account.id, { status: "completed", workflowId, message });
    },
    markSkipped: async (account, message) => {
      store.markAccount(jobId, account.id, { status: "skipped", workflowId, message });
    },
    markFailed: async (account, error) => {
      store.markAccount(jobId, account.id, { status: "failed", workflowId, error: error.message });
    }
  };
}


