import { describe, expect, it } from "vitest";
import { AutomationRunner } from "../src/automation/runner.js";
import type { AutomationFlow, ProgressAdapter, SubAccount } from "../src/automation/types.js";

function createNoopProgress(): ProgressAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
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
}

describe("AutomationRunner concurrency", () => {
  it("processes accounts in parallel when concurrency > 1", async () => {
    const concurrentPeaks: number[] = [];
    let active = 0;

    const flow: AutomationFlow = {
      name: "test-flow",
      run: async () => {
        active += 1;
        concurrentPeaks.push(active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return { status: "completed" };
      }
    };

    const progress = createNoopProgress();
    const accounts: SubAccount[] = Array.from({ length: 6 }, (_, i) => ({
      id: `acc-${i}`,
      name: `Account ${i}`
    }));

    const runner = new AutomationRunner({
      flow,
      progress,
      concurrency: 3
    });
    const result = await runner.run(accounts);

    expect(result.completed).toBe(6);
    expect(result.failed).toBe(0);
    // At some point, more than 1 account should have been active simultaneously
    expect(Math.max(...concurrentPeaks)).toBeGreaterThan(1);
  });

  it("respects concurrency=1 as sequential", async () => {
    const order: string[] = [];

    const flow: AutomationFlow = {
      name: "test-flow",
      run: async ({ account }) => {
        order.push(account.id);
        return { status: "completed" };
      }
    };

    const progress = createNoopProgress();
    const accounts: SubAccount[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" }
    ];

    const runner = new AutomationRunner({
      flow,
      progress,
      concurrency: 1
    });
    const result = await runner.run(accounts);

    expect(result.completed).toBe(3);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("stops processing new accounts when cancellation is triggered", async () => {
    const processed: string[] = [];
    const cancellation = { cancelled: false };

    const flow: AutomationFlow = {
      name: "test-flow",
      run: async ({ account }) => {
        processed.push(account.id);
        if (account.id === "b") {
          cancellation.cancelled = true;
        }
        return { status: "completed" };
      }
    };

    const progress = createNoopProgress();
    const accounts: SubAccount[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" }
    ];

    const runner = new AutomationRunner({
      flow,
      progress,
      concurrency: 1,
      cancellation
    });
    const result = await runner.run(accounts);

    // Should have processed a and b, then stopped
    expect(processed).toEqual(["a", "b"]);
    expect(result.completed).toBe(2);
  });

  it("cancellation works with parallel processing", async () => {
    const processed: string[] = [];
    const cancellation = { cancelled: false };

    const flow: AutomationFlow = {
      name: "test-flow",
      run: async ({ account }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        processed.push(account.id);
        if (processed.length >= 2) {
          cancellation.cancelled = true;
        }
        return { status: "completed" };
      }
    };

    const progress = createNoopProgress();
    const accounts: SubAccount[] = Array.from({ length: 10 }, (_, i) => ({
      id: `acc-${i}`,
      name: `Account ${i}`
    }));

    const runner = new AutomationRunner({
      flow,
      progress,
      concurrency: 3,
      cancellation
    });
    const result = await runner.run(accounts);

    // Should not have processed all 10 accounts
    expect(result.completed).toBeLessThan(10);
    expect(processed.length).toBeLessThan(10);
  });
});
