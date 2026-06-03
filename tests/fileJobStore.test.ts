import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { createFileJobStore } from "../src/server/services/fileJobStore.js";

const testDir = path.resolve("output/test-jobs");

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
});

describe("createFileJobStore", () => {
  it("creates a job and persists it to disk", () => {
    const store = createFileJobStore({ directory: testDir });
    const job = store.createJob({
      accountIds: ["acc-1", "acc-2"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });

    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.accounts).toHaveLength(2);
    expect(job.summary.queued).toBe(2);

    // Verify file was written
    const files = readdirSync(testDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${job.id}.json`);
  });

  it("retrieves a job by ID", () => {
    const store = createFileJobStore({ directory: testDir });
    const created = store.createJob({
      accountIds: ["acc-1"],
      workflowIds: ["add-business-address"],
      dryRun: false,
      addressProfile: "australia_sydney"
    });

    const retrieved = store.getJob(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.input.dryRun).toBe(false);
  });

  it("returns undefined for non-existent job", () => {
    const store = createFileJobStore({ directory: testDir });
    expect(store.getJob("non-existent-id")).toBeUndefined();
  });

  it("marks job status and persists", () => {
    const store = createFileJobStore({ directory: testDir });
    const job = store.createJob({
      accountIds: ["acc-1"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });

    const updated = store.markJob(job.id, "running", "Starting automation");
    expect(updated.status).toBe("running");
    expect(updated.events).toHaveLength(2);
    expect(updated.events[1].message).toBe("Starting automation");
  });

  it("marks account status and updates summary", () => {
    const store = createFileJobStore({ directory: testDir });
    const job = store.createJob({
      accountIds: ["acc-1", "acc-2"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });

    store.markAccount(job.id, "acc-1", { status: "running", workflowId: "add-business-address" });
    const afterRunning = store.getJob(job.id)!;
    expect(afterRunning.summary.running).toBe(1);
    expect(afterRunning.summary.queued).toBe(1);

    store.markAccount(job.id, "acc-1", { status: "completed", workflowId: "add-business-address" });
    const afterCompleted = store.getJob(job.id)!;
    expect(afterCompleted.summary.completed).toBe(1);
    expect(afterCompleted.summary.queued).toBe(1);
    expect(afterCompleted.accounts[0].completedAt).toBeTruthy();
  });

  it("lists jobs sorted by creation time (newest first)", async () => {
    const store = createFileJobStore({ directory: testDir });
    store.createJob({
      accountIds: ["acc-1"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });
    // Small delay to ensure distinct timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.createJob({
      accountIds: ["acc-2"],
      workflowIds: ["add-business-address"],
      dryRun: false,
      addressProfile: "singapore"
    });

    const jobs = store.listJobs();
    expect(jobs).toHaveLength(2);
    // Newest first
    expect(jobs[0].input.addressProfile).toBe("singapore");
    expect(jobs[1].input.addressProfile).toBe("australia_sydney");
  });

  it("survives re-instantiation (loads from disk)", () => {
    const store1 = createFileJobStore({ directory: testDir });
    const job = store1.createJob({
      accountIds: ["acc-1"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });
    store1.markJob(job.id, "completed", "Done");

    // Create a new store instance pointing to the same directory
    const store2 = createFileJobStore({ directory: testDir });
    const loaded = store2.getJob(job.id);
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe("completed");
    expect(loaded!.events).toHaveLength(2);
  });
});
