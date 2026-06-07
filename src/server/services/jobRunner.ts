import { chromium } from "playwright";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ProgressAdapter, SubAccount } from "../../automation/types.js";
import type { FlowInput, FlowResult } from "../../automation/types.js";
import { AutomationRunner } from "../../automation/runner.js";
import { loadConfig } from "../../config.js";
import { createLogger, parseLogLevel } from "../../logger.js";
import { validateDocumentFiles } from "../../preflight.js";
import { loginAsMasterAdmin } from "../../zoom/auth.js";
import { SessionHealthMonitor } from "../../zoom/sessionHealth.js";
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
  /** Per-account parameter values keyed by account id, then parameter name. */
  accountValues?: Record<string, Record<string, string>>;
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

  if (options.accountValues) {
    config.accountValues = options.accountValues;
  }

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

    // Keep the master session alive across long, many-account runs. The monitor
    // re-logs in when the session approaches its max age; flows read the latest
    // state via getMasterStorageState().
    const sessionMonitor = new SessionHealthMonitor(masterStorageState, { browser, config: config.zoom, logger });
    const refreshAtMs = 40 * 60 * 1_000;
    let refreshInFlight: Promise<unknown> | undefined;
    const refreshSessionIfStale = async (): Promise<void> => {
      if (sessionMonitor.getHealthState().sessionAgeMs < refreshAtMs) return;
      // Deduplicate concurrent refreshes (parallel workers share one session).
      refreshInFlight ??= sessionMonitor.refresh().finally(() => { refreshInFlight = undefined; });
      await refreshInFlight;
    };

    let totalCompleted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const workflow of workflows) {
      if (options.cancellation?.cancelled) break;

      logger.info(`Starting pipeline step: ${workflow.name}`, { workflowId: workflow.id });
      options.store.markJob(options.jobId, "running", `Running step: ${workflow.name}`);

      const createFlow = () => options.registry.createFlow(workflow.id, {
        browser,
        masterStorageState,
        getMasterStorageState: () => sessionMonitor.getStorageState(),
        config,
        logger
      });
      const flow = {
        name: workflow.id,
        run(input: FlowInput): Promise<FlowResult> {
          return logger.runWithAccount(input.account.id, () => createFlow().run(input));
        }
      };
      const progressAdapter = createJobProgressAdapter(options.store, options.jobId, workflow.id);
      const trackingProgress: ProgressAdapter = {
        ...progressAdapter,
        markRunning: async (account) => logger.runWithAccount(account.id, () => progressAdapter.markRunning(account)),
        markCompleted: async (account, message) => logger.runWithAccount(account.id, () => progressAdapter.markCompleted(account, message)),
        markFailed: async (account, error, retryable) => logger.runWithAccount(account.id, () => progressAdapter.markFailed(account, error, retryable)),
        markSkipped: async (account, message) => logger.runWithAccount(account.id, () => progressAdapter.markSkipped(account, message))
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
        cancellation: options.cancellation,
        beforeEachAccount: refreshSessionIfStale
      });

      const summary = await runner.run(options.accounts);
      totalCompleted += summary.completed;
      totalSkipped += summary.skipped;
      totalFailed += summary.failed;
    }

    // Respect a cancellation requested mid-run: don't overwrite "cancelled" with completed/failed.
    const finalStatus = options.cancellation?.cancelled ? "cancelled" : totalFailed > 0 ? "failed" : "completed";
    options.store.markJob(
      options.jobId,
      finalStatus,
      `Finished pipeline (${pipelineLabel}): ${totalCompleted} completed, ${totalSkipped} skipped, ${totalFailed} failed`
    );
  } finally {
    await browser.close();
  }
}

export function createJobProgressAdapter(store: JobStore, jobId: string, workflowId: string): ProgressAdapter {
  return {
    shouldSkip: async (account) => {
      const job = store.getJob(jobId);
      const accountState = job?.accounts.find((item) => item.accountId === account.id);
      if (accountState?.status !== "failed") {
        return false;
      }

      store.logAccountStep(jobId, account.id, "Skipping workflow", "Previous workflow failed");
      return true;
    },
    markRunning: async (account) => {
      store.markAccount(jobId, account.id, { status: "running", workflowId });
      store.logAccountStep(jobId, account.id, "Starting workflow", workflowId, {
        workflowId,
        stepId: "workflow-start",
        stepName: "Starting workflow",
        level: "info"
      });
    },
    markCompleted: async (account, message) => {
      store.logAccountStep(jobId, account.id, "Completed", message, {
        workflowId,
        stepId: "workflow-complete",
        stepName: "Completed",
        level: "success"
      });
      store.markAccount(jobId, account.id, { status: "completed", workflowId, message });
    },
    markSkipped: async (account, message) => {
      store.logAccountStep(jobId, account.id, "Skipped", message, {
        workflowId,
        stepId: "workflow-skipped",
        stepName: "Skipped",
        level: "warning"
      });
      store.markAccount(jobId, account.id, { status: "skipped", workflowId, message });
    },
    markFailed: async (account, error) => {
      store.logAccountStep(jobId, account.id, "Failed", error.message, {
        workflowId,
        stepId: "workflow-failed",
        stepName: "Failed",
        level: "error"
      });
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
  jobId: string,
  activeAccount = new AsyncLocalStorage<string>()
): import("../../logger.js").Logger & { runWithAccount<T>(accountId: string, callback: () => T): T } {
  return {
    runWithAccount<T>(accountId: string, callback: () => T): T {
      return activeAccount.run(accountId, callback);
    },
    debug(message: string, meta?: Record<string, unknown>) {
      baseLogger.debug(message, meta);
    },
    info(message: string, meta?: Record<string, unknown>) {
      baseLogger.info(message, meta);
      const activeAccountId = activeAccount.getStore();
      if (activeAccountId && isUserFacingStep(message)) {
        try {
          store.logAccountStep(jobId, activeAccountId, message, undefined, {
            stepName: message,
            level: "info"
          });
        } catch { /* ignore */ }
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      baseLogger.warn(message, meta);
      const activeAccountId = activeAccount.getStore();
      if (activeAccountId) {
        try { store.logAccountStep(jobId, activeAccountId, `Warning: ${message}`, undefined, { stepName: message, level: "warning" }); } catch { /* ignore */ }
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      baseLogger.error(message, meta);
      const activeAccountId = activeAccount.getStore();
      if (activeAccountId) {
        try { store.logAccountStep(jobId, activeAccountId, `Error: ${message}`, undefined, { stepName: message, level: "error" }); } catch { /* ignore */ }
      }
    },
    child(meta: Record<string, unknown>) {
      return createStepTrackingLogger(baseLogger.child(meta), store, jobId, activeAccount);
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
