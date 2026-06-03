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

  const baseLogger = createLogger({
    level: parseLogLevel(process.env.LOG_LEVEL),
    filePath: `${config.runtime.artifactsDir}/logs/job-${options.jobId}.jsonl`,
    baseMeta: { jobId: options.jobId, workflows: options.workflowIds }
  });
  const logger = createStepTrackingLogger(baseLogger, options.store, options.jobId);

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
      const progressAdapter = createJobProgressAdapter(options.store, options.jobId, workflow.id);
      // Wrap markRunning to set active account on the step-tracking logger
      const trackingProgress: ProgressAdapter = {
        ...progressAdapter,
        markRunning: async (account) => {
          logger.setActiveAccount(account.id);
          return progressAdapter.markRunning(account);
        },
        markCompleted: async (account, message) => {
          const result = await progressAdapter.markCompleted(account, message);
          logger.setActiveAccount(undefined);
          return result;
        },
        markFailed: async (account, error, retryable) => {
          const result = await progressAdapter.markFailed(account, error, retryable);
          logger.setActiveAccount(undefined);
          return result;
        },
        markSkipped: async (account, message) => {
          const result = await progressAdapter.markSkipped(account, message);
          logger.setActiveAccount(undefined);
          return result;
        }
      };
      const runner = new AutomationRunner({
        flow,
        progress: trackingProgress,
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
      store.logAccountStep(jobId, account.id, "Starting workflow", workflowId);
    },
    markCompleted: async (account, message) => {
      store.logAccountStep(jobId, account.id, "Completed", message);
      store.markAccount(jobId, account.id, { status: "completed", workflowId, message });
    },
    markSkipped: async (account, message) => {
      store.logAccountStep(jobId, account.id, "Skipped", message);
      store.markAccount(jobId, account.id, { status: "skipped", workflowId, message });
    },
    markFailed: async (account, error) => {
      store.logAccountStep(jobId, account.id, "Failed", error.message);
      store.markAccount(jobId, account.id, { status: "failed", workflowId, error: error.message });
    }
  };
}

/**
 * Create a logger that also emits step-level events to the job store.
 * This allows the UI to show real-time progress per account.
 */
function createStepTrackingLogger(
  baseLogger: import("../../logger.js").Logger,
  store: JobStore,
  jobId: string
): import("../../logger.js").Logger & { setActiveAccount(accountId: string | undefined): void } {
  let activeAccountId: string | undefined;

  return {
    setActiveAccount(accountId: string | undefined) {
      activeAccountId = accountId;
    },
    debug(message: string, meta?: Record<string, unknown>) {
      baseLogger.debug(message, meta);
    },
    info(message: string, meta?: Record<string, unknown>) {
      baseLogger.info(message, meta);
      if (activeAccountId && isUserFacingStep(message)) {
        try { store.logAccountStep(jobId, activeAccountId, message); } catch { /* ignore */ }
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      baseLogger.warn(message, meta);
      if (activeAccountId) {
        try { store.logAccountStep(jobId, activeAccountId, `⚠ ${message}`); } catch { /* ignore */ }
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      baseLogger.error(message, meta);
      if (activeAccountId) {
        try { store.logAccountStep(jobId, activeAccountId, `✗ ${message}`); } catch { /* ignore */ }
      }
    },
    child(meta: Record<string, unknown>) {
      return createStepTrackingLogger(baseLogger.child(meta), store, jobId);
    }
  };
}

/**
 * Filter log messages to only show user-facing steps (not internal debug noise).
 */
function isUserFacingStep(message: string): boolean {
  const patterns = [
    /navigat/i, /click/i, /fill/i, /select/i, /upload/i, /wait/i,
    /impersonat/i, /dismiss/i, /verif/i, /submit/i, /search/i,
    /address/i, /phone/i, /number/i, /document/i, /form/i,
    /login/i, /session/i, /page/i, /popup/i, /save/i, /done/i
  ];
  return patterns.some((p) => p.test(message));
}


