import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileAuditStore } from "../src/server/audit/auditStore.js";
import { computeOperationsMetrics } from "../src/server/operations/runMetricsService.js";
import { createRunManifest } from "../src/server/operations/reportExporter.js";
import type { AutomationJob } from "../src/server/services/inMemoryJobStore.js";
import type { WorkItem } from "../src/server/queues/types.js";
import type { WorkerRecord } from "../src/server/workers/types.js";

describe("audit and operations reporting", () => {
  it("appends immutable audit events and filters by job id", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "zoom-audit-"));
    try {
      const store = createFileAuditStore(path.join(directory, "audit.jsonl"));
      store.append({
        eventType: "live_run_started",
        actor: "operator",
        jobId: "job-1",
        message: "Live run started"
      });
      store.append({
        eventType: "workflow_approved",
        actor: "admin",
        workflowId: "wf-1",
        message: "Workflow approved"
      });

      expect(store.list({ jobId: "job-1" })).toEqual([
        expect.objectContaining({ eventType: "live_run_started", jobId: "job-1" })
      ]);
      expect(store.list()).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("computes queue, worker, and failure metrics", () => {
    const metrics = computeOperationsMetrics({
      jobs: [job("job-1", "failed")],
      workItems: [
        workItem("new", "a1"),
        workItem("leased", "a2"),
        workItem("failed", "a3", "selector"),
        workItem("succeeded", "a4")
      ],
      workers: [
        worker("worker-a", "online"),
        worker("worker-b", "offline")
      ]
    });

    expect(metrics.queueDepth).toBe(2);
    expect(metrics.activeWorkers).toBe(1);
    expect(metrics.failureCategories).toEqual({ selector: 1 });
  });

  it("creates a compact run manifest for evidence export", () => {
    const manifest = createRunManifest({
      job: job("job-1", "completed"),
      workItems: [workItem("succeeded", "a1")],
      artifacts: [{ name: "trace.zip", type: "trace", sizeBytes: 10, modifiedAt: "2026-06-07T00:00:00.000Z", url: "/artifacts/trace.zip", downloadUrl: "/artifacts/trace.zip" }]
    });

    expect(manifest.jobId).toBe("job-1");
    expect(manifest.accounts).toEqual([{ accountId: "a1", status: "succeeded", failureCategory: undefined }]);
    expect(manifest.artifacts[0].name).toBe("trace.zip");
  });
});

function job(id: string, status: AutomationJob["status"]): AutomationJob {
  return {
    id,
    status,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:01:00.000Z",
    input: { accountIds: ["a1"], workflowIds: ["wf"], dryRun: true, addressProfile: "au" },
    accounts: [{ accountId: "a1", status: status === "failed" ? "failed" : "completed" }],
    summary: { queued: 0, running: 0, completed: status === "failed" ? 0 : 1, skipped: 0, failed: status === "failed" ? 1 : 0 },
    events: []
  };
}

function workItem(status: WorkItem["status"], accountId: string, failureCategory?: WorkItem["failureCategory"]): WorkItem {
  return {
    id: `${accountId}-${status}`,
    jobId: "job-1",
    accountId,
    workflowIds: ["wf"],
    status,
    attempt: 1,
    maxAttempts: 2,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    failureCategory,
    artifactRefs: [],
    history: []
  };
}

function worker(workerId: string, status: WorkerRecord["status"]): WorkerRecord {
  return {
    workerId,
    status,
    labels: {},
    registeredAt: "2026-06-07T00:00:00.000Z",
    lastHeartbeatAt: "2026-06-07T00:00:00.000Z"
  };
}
