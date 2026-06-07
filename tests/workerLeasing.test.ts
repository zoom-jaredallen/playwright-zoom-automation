import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileWorkItemStore } from "../src/server/queues/fileWorkItemStore.js";
import { createFileWorkerRegistry } from "../src/server/workers/fileWorkerRegistry.js";
import { createWorkerLeaseService } from "../src/server/workers/workerLeaseService.js";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zoom-workers-"));
}

describe("distributed worker leasing", () => {
  it("registers workers, heartbeats, and marks stale workers offline", () => {
    const directory = tempDir();
    try {
      const registry = createFileWorkerRegistry(path.join(directory, "workers.json"));
      registry.register({ workerId: "worker-a", labels: { host: "runner-1" }, now: "2026-06-07T00:00:00.000Z" });
      registry.heartbeat("worker-a", "2026-06-07T00:00:05.000Z");

      expect(registry.get("worker-a")).toEqual(expect.objectContaining({
        workerId: "worker-a",
        status: "online",
        lastHeartbeatAt: "2026-06-07T00:00:05.000Z"
      }));

      const expired = registry.markStaleOffline({
        now: "2026-06-07T00:01:10.000Z",
        staleAfterMs: 60_000
      });
      expect(expired.map((worker) => worker.workerId)).toEqual(["worker-a"]);
      expect(registry.get("worker-a")?.status).toBe("offline");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("claims work items with worker leases without double assignment", () => {
    const directory = tempDir();
    try {
      const workItems = createFileWorkItemStore({ directory: path.join(directory, "items") });
      const registry = createFileWorkerRegistry(path.join(directory, "workers.json"));
      const leaseService = createWorkerLeaseService({ workItems, workers: registry });
      workItems.createWorkItems({
        jobId: "job-1",
        accountIds: ["a1"],
        workflowIds: ["wf"],
        maxAttempts: 2,
        now: "2026-06-07T00:00:00.000Z"
      });
      registry.register({ workerId: "worker-a", now: "2026-06-07T00:00:00.000Z" });
      registry.register({ workerId: "worker-b", now: "2026-06-07T00:00:00.000Z" });

      const first = leaseService.claimNext("worker-a", {
        leaseMs: 30_000,
        now: "2026-06-07T00:00:01.000Z"
      });
      const second = leaseService.claimNext("worker-b", {
        leaseMs: 30_000,
        now: "2026-06-07T00:00:02.000Z"
      });

      expect(first?.workerId).toBe("worker-a");
      expect(second).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
