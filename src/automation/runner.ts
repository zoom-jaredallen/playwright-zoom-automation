import type { AutomationFlow, ProgressAdapter, RunSummary, SubAccount } from "./types.js";
import { retry, type RetryOptions } from "./retry.js";

export interface AutomationRunnerOptions {
  flow: AutomationFlow;
  progress: ProgressAdapter;
  retry?: RetryOptions;
  accountDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class AutomationRunner {
  constructor(private readonly options: AutomationRunnerOptions) {}

  async run(accounts: SubAccount[]): Promise<RunSummary> {
    const summary: RunSummary = { completed: 0, failed: 0, skipped: 0 };

    for (const account of accounts) {
      if (await this.options.progress.shouldSkip(account)) {
        summary.skipped += 1;
        continue;
      }

      try {
        await this.options.progress.markRunning(account);
        const result = await this.runFlowWithRetry(account);

        if (result.status === "skipped") {
          await this.options.progress.markSkipped(account, result.message);
          summary.skipped += 1;
          continue;
        }

        await this.options.progress.markCompleted(account, result.message);
        summary.completed += 1;
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const retryable = Boolean((normalizedError as Error & { retryable?: boolean }).retryable);
        await this.options.progress.markFailed(account, normalizedError, retryable);
        summary.failed += 1;
      }

      await this.delayBetweenAccounts();
    }

    return summary;
  }

  private async runFlowWithRetry(account: SubAccount) {
    if (!this.options.retry || this.options.retry.attempts <= 1) {
      return this.options.flow.run({ account });
    }

    return retry(
      async () => this.options.flow.run({ account }).catch((error) => {
        throw normalizeAutomationError(error);
      }),
      this.options.retry
    );
  }

  private async delayBetweenAccounts(): Promise<void> {
    const delayMs = this.options.accountDelayMs ?? 0;
    if (delayMs <= 0) {
      return;
    }

    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    await sleep(delayMs);
  }
}

function normalizeAutomationError(error: unknown): Error {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const alreadyRetryable = Boolean((normalizedError as Error & { retryable?: boolean }).retryable);
  if (alreadyRetryable) {
    return normalizedError;
  }

  if (isRetryableBrowserFailure(normalizedError)) {
    Object.assign(normalizedError, { retryable: true });
  }

  return normalizedError;
}

function isRetryableBrowserFailure(error: Error): boolean {
  const message = error.message.toLowerCase();
  if (message.includes("missing required") || message.includes("is required because zoom rendered")) {
    return false;
  }

  return (
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("net::") ||
    message.includes("target closed") ||
    message.includes("could not verify that the business address was added") ||
    message.includes("zoom redirected to sign-in")
  );
}
