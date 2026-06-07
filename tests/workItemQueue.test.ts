import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileWorkItemStore } from "../src/server/queues/fileWorkItemStore.js";

function tempQueueDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zoom-work-items-"));
}

describe("file work item queue", () => {
  it("persists account work items across store instances", () => {
    const directory = tempQueueDir();
    try {
      const store = createFileWorkItemStore({ directory });
      const [first, second] = store.createWorkItems({
        jobId: "job-1",
        accountIds: ["acct-1", "acct-2"],
        workflowIds: ["wf-a", "wf-b"],
        maxAttempts: 3
      });

      const reloaded = createFileWorkItemStore({ directory });
      expect(reloaded.getWorkItem(first.id)?.accountId).toBe("acct-1");
      expect(reloaded.getWorkItem(second.id)?.workflowIds).toEqual(["wf-a", "wf-b"]);
      expect(reloaded.listWorkItems({ jobId: "job-1" }).map((item) => item.status)).toEqual(["new", "new"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("leases each available work item once and reclaims expired leases", () => {
    const directory = tempQueueDir();
    try {
      const store = createFileWorkItemStore({ directory });
      store.createWorkItems({
        jobId: "job-1",
        accountIds: ["acct-1"],
        workflowIds: ["wf-a"],
        maxAttempts: 2
      });

      const leased = store.claimNext({
        workerId: "worker-a",
        leaseMs: 5_000,
        now: "2026-06-07T00:00:00.000Z"
      });

      expect(leased?.status).toBe("leased");
      expect(leased?.attempt).toBe(1);
      expect(store.claimNext({ workerId: "worker-b", leaseMs: 5_000, now: "2026-06-07T00:00:01.000Z" })).toBeUndefined();

      const reclaimed = store.releaseExpiredLeases("2026-06-07T00:00:06.000Z");
      expect(reclaimed.map((item) => item.accountId)).toEqual(["acct-1"]);
      expect(store.getWorkItem(leased!.id)?.status).toBe("retrying");

      const leasedAgain = store.claimNext({
        workerId: "worker-b",
        leaseMs: 5_000,
        now: "2026-06-07T00:00:07.000Z"
      });
      expect(leasedAgain?.workerId).toBe("worker-b");
      expect(leasedAgain?.attempt).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("tracks retryable failures and explicit failed-item requeues", () => {
    const directory = tempQueueDir();
    try {
      const store = createFileWorkItemStore({ directory });
      const [item] = store.createWorkItems({
        jobId: "job-1",
        accountIds: ["acct-1"],
        workflowIds: ["wf-a"],
        maxAttempts: 2
      });

      store.claimNext({ workerId: "worker-a", leaseMs: 5_000, now: "2026-06-07T00:00:00.000Z" });
      const retrying = store.markFailed(item.id, {
        error: "timeout",
        retryable: true,
        retryDelayMs: 1_000,
        category: "timeout",
        now: "2026-06-07T00:00:01.000Z"
      });
      expect(retrying.status).toBe("retrying");
      expect(retrying.nextAttemptAt).toBe("2026-06-07T00:00:02.000Z");

      store.claimNext({ workerId: "worker-a", leaseMs: 5_000, now: "2026-06-07T00:00:02.000Z" });
      const failed = store.markFailed(item.id, {
        error: "timeout again",
        retryable: true,
        retryDelayMs: 1_000,
        category: "timeout",
        now: "2026-06-07T00:00:03.000Z"
      });
      expect(failed.status).toBe("failed");
      expect(failed.failureCategory).toBe("timeout");

      const [requeued] = store.requeueFailed({ jobId: "job-1", accountIds: ["acct-1"], now: "2026-06-07T00:00:04.000Z" });
      expect(requeued.status).toBe("new");
      expect(requeued.attempt).toBe(0);
      expect(requeued.history.at(-1)?.event).toBe("requeued");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
