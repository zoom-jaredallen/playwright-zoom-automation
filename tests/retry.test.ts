import { describe, expect, it } from "vitest";
import { retry } from "../src/automation/retry.js";

describe("retry", () => {
  it("retries retryable failures and returns the successful result", async () => {
    const attempts: number[] = [];

    const result = await retry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) {
          const error = new Error("temporary");
          Object.assign(error, { retryable: true });
          throw error;
        }
        return "ok";
      },
      { attempts: 3, baseDelayMs: 10, sleep: async () => undefined }
    );

    expect(result).toBe("ok");
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("does not retry non-retryable failures", async () => {
    let attempts = 0;

    await expect(
      retry(
        async () => {
          attempts += 1;
          throw new Error("validation failed");
        },
        { attempts: 3, baseDelayMs: 10, sleep: async () => undefined }
      )
    ).rejects.toThrow("validation failed");

    expect(attempts).toBe(1);
  });
});
