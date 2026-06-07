import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listJobArtifacts } from "../src/server/services/artifacts.js";
import type { AutomationJob } from "../src/server/services/inMemoryJobStore.js";

const artifactsDir = path.resolve(".tmp/test-artifacts");

beforeEach(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
});

afterEach(() => {
  rmSync(path.resolve(".tmp"), { recursive: true, force: true });
});

describe("listJobArtifacts", () => {
  it("builds stable URLs relative to the configured artifacts directory", () => {
    writeFileSync(path.join(artifactsDir, "a301-trace.zip"), "trace", "utf8");
    const job = createJob();

    const artifacts = listJobArtifacts({
      artifactsDir,
      job,
      accountId: "a301"
    });

    expect(artifacts).toEqual([
      expect.objectContaining({
        name: "a301-trace.zip",
        url: "/artifacts/a301-trace.zip",
        downloadUrl: "/artifacts/a301-trace.zip?download=1"
      })
    ]);
  });
});

function createJob(): AutomationJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    input: {
      accountIds: ["a301"],
      workflowIds: ["check-business-address-status"],
      dryRun: true,
      addressProfile: "australia_sydney"
    },
    accounts: [{ accountId: "a301", status: "completed" }],
    summary: { queued: 0, running: 0, completed: 1, skipped: 0, failed: 0 },
    events: []
  };
}
