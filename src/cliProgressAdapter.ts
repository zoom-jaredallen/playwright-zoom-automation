import type { ProgressAdapter, SubAccount } from "./automation/types.js";
import { CliProgress } from "./progress.js";

/**
 * A ProgressAdapter that wraps another adapter (e.g., ProgressStore) and
 * also drives the CLI progress display. This keeps the runner unaware of
 * the CLI output while providing real-time feedback.
 */
export class CliProgressAdapter implements ProgressAdapter {
  readonly display: CliProgress;

  constructor(
    private readonly inner: ProgressAdapter,
    totalAccounts: number
  ) {
    this.display = new CliProgress(totalAccounts);
  }

  async shouldSkip(account: SubAccount): Promise<boolean> {
    const skip = await this.inner.shouldSkip(account);
    if (skip) {
      this.display.onProgressSkipped(account);
    }
    return skip;
  }

  async markRunning(account: SubAccount): Promise<void> {
    this.display.onAccountStart(account);
    return this.inner.markRunning(account);
  }

  async markCompleted(account: SubAccount, message?: string): Promise<void> {
    this.display.onAccountCompleted(account, message);
    return this.inner.markCompleted(account, message);
  }

  async markSkipped(account: SubAccount, message?: string): Promise<void> {
    this.display.onAccountSkipped(account, message);
    return this.inner.markSkipped(account, message);
  }

  async markFailed(account: SubAccount, error: Error, retryable: boolean): Promise<void> {
    this.display.onAccountFailed(account, error);
    return this.inner.markFailed(account, error, retryable);
  }
}
