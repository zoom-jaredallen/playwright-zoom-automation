import { describe, expect, it } from "vitest";
import { AutomationRunner } from "../src/automation/runner.js";
import type { AutomationFlow, ProgressAdapter, SubAccount } from "../src/automation/types.js";

describe("AutomationRunner", () => {
  it("skips completed accounts and runs the flow sequentially for the rest", async () => {
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async (account) => account.id === "done",
      markRunning: async (account) => {
        calls.push(`running:${account.id}`);
      },
      markCompleted: async (account) => {
        calls.push(`completed:${account.id}`);
      },
      markSkipped: async (account, message) => {
        calls.push(`skipped:${account.id}:${message ?? ""}`);
      },
      markFailed: async (account) => {
        calls.push(`failed:${account.id}`);
      }
    };
    const flow: AutomationFlow = {
      name: "test-flow",
      run: async ({ account }) => {
        calls.push(`flow:${account.id}`);
        return { status: "completed" };
      }
    };
    const accounts: SubAccount[] = [
      { id: "done", name: "Already Done" },
      { id: "todo", name: "Needs Work" }
    ];

    const runner = new AutomationRunner({ flow, progress });
    const result = await runner.run(accounts);

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 1 });
    expect(calls).toEqual(["running:todo", "flow:todo", "completed:todo"]);
  });

  it("marks failed accounts without stopping the batch", async () => {
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async () => false,
      markRunning: async (account) => {
        calls.push(`running:${account.id}`);
      },
      markCompleted: async (account) => {
        calls.push(`completed:${account.id}`);
      },
      markSkipped: async (account, message) => {
        calls.push(`skipped:${account.id}:${message ?? ""}`);
      },
      markFailed: async (account, error, retryable) => {
        calls.push(`failed:${account.id}:${retryable}:${error.message}`);
      }
    };
    const flow: AutomationFlow = {
      name: "test-flow",
      run: async ({ account }) => {
        if (account.id === "bad") {
          const error = new Error("temporary Zoom issue");
          Object.assign(error, { retryable: true });
          throw error;
        }
        return { status: "completed" };
      }
    };

    const runner = new AutomationRunner({ flow, progress });
    const result = await runner.run([
      { id: "bad", name: "Bad Account" },
      { id: "good", name: "Good Account" }
    ]);

    expect(result).toEqual({ completed: 1, failed: 1, skipped: 0 });
    expect(calls).toEqual([
      "running:bad",
      "failed:bad:true:temporary Zoom issue",
      "running:good",
      "completed:good"
    ]);
  });

  it("persists accounts skipped by the flow", async () => {
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async () => false,
      markRunning: async (account) => {
        calls.push(`running:${account.id}`);
      },
      markCompleted: async (account) => {
        calls.push(`completed:${account.id}`);
      },
      markSkipped: async (account, message) => {
        calls.push(`skipped:${account.id}:${message ?? ""}`);
      },
      markFailed: async (account) => {
        calls.push(`failed:${account.id}`);
      }
    };
    const flow: AutomationFlow = {
      name: "test-flow",
      run: async () => ({ status: "skipped", message: "Dry run completed before form submission" })
    };

    const runner = new AutomationRunner({ flow, progress });
    const result = await runner.run([{ id: "dry", name: "Dry Run" }]);

    expect(result).toEqual({ completed: 0, failed: 0, skipped: 1 });
    expect(calls).toEqual(["running:dry", "skipped:dry:Dry run completed before form submission"]);
  });

  it("passes completed flow messages to progress", async () => {
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async () => false,
      markRunning: async (account) => {
        calls.push(`running:${account.id}`);
      },
      markCompleted: async (account, message) => {
        calls.push(`completed:${account.id}:${message ?? ""}`);
      },
      markSkipped: async (account, message) => {
        calls.push(`skipped:${account.id}:${message ?? ""}`);
      },
      markFailed: async (account) => {
        calls.push(`failed:${account.id}`);
      }
    };
    const flow: AutomationFlow = {
      name: "status-check",
      run: async () => ({ status: "completed", message: "Address status: Pending" })
    };

    const runner = new AutomationRunner({ flow, progress });
    const result = await runner.run([{ id: "a301", name: "Account 301" }]);

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 });
    expect(calls).toEqual(["running:a301", "completed:a301:Address status: Pending"]);
  });

  it("retries retryable flow failures before marking the account completed", async () => {
    const attempts: number[] = [];
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async () => false,
      markRunning: async (account) => {
        calls.push(`running:${account.id}`);
      },
      markCompleted: async (account) => {
        calls.push(`completed:${account.id}`);
      },
      markSkipped: async (account, message) => {
        calls.push(`skipped:${account.id}:${message ?? ""}`);
      },
      markFailed: async (account) => {
        calls.push(`failed:${account.id}`);
      }
    };
    const flow: AutomationFlow = {
      name: "test-flow",
      run: async () => {
        attempts.push(attempts.length + 1);
        if (attempts.length < 3) {
          const error = new Error("Zoom page temporarily unavailable");
          Object.assign(error, { retryable: true });
          throw error;
        }
        return { status: "completed" };
      }
    };

    const runner = new AutomationRunner({
      flow,
      progress,
      retry: { attempts: 3, baseDelayMs: 10, sleep: async () => undefined }
    });
    const result = await runner.run([{ id: "flaky", name: "Flaky Account" }]);

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 });
    expect(attempts).toEqual([1, 2, 3]);
    expect(calls).toEqual(["running:flaky", "completed:flaky"]);
  });

  it("does not retry non-retryable flow failures", async () => {
    let attempts = 0;
    const calls: string[] = [];
    const progress: ProgressAdapter = {
      shouldSkip: async () => false,
      markRunning: async () => undefined,
      markCompleted: async () => undefined,
      markSkipped: async () => undefined,
      markFailed: async (account, error, retryable) => {
        calls.push(`failed:${account.id}:${retryable}:${error.message}`);
      }
    };
    const flow: AutomationFlow = {
      name: "test-flow",
      run: async () => {
        attempts += 1;
        throw new Error("missing required form field");
      }
    };

    const runner = new AutomationRunner({
      flow,
      progress,
      retry: { attempts: 3, baseDelayMs: 10, sleep: async () => undefined }
    });
    const result = await runner.run([{ id: "bad", name: "Bad Account" }]);

    expect(result).toEqual({ completed: 0, failed: 1, skipped: 0 });
    expect(attempts).toBe(1);
    expect(calls).toEqual(["failed:bad:false:missing required form field"]);
  });
});
