import type { RetryableError } from "./types.js";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = Boolean((error as RetryableError).retryable);
      const isLastAttempt = attempt >= options.attempts;

      if (!retryable || isLastAttempt) {
        throw error;
      }

      const retryAfterMs = (error as RetryableError).retryAfterMs;
      const delayMs = retryAfterMs ?? options.baseDelayMs * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  // Reached only when options.attempts <= 0; the loop body never runs.
  throw lastError instanceof Error ? lastError : new Error("Retry operation failed");
}
