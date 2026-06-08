import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommandInput, buildWorkflowHardeningPreview, formatHardeningSummary, formatSnapshotSummary } from "../src/recorderDebug/cli.js";
import type { RecorderDebugSnapshot } from "../src/recorderDebug/types.js";
import type { RecordedWorkflow } from "@zoom-automation/workflow-core";

describe("recorder debug CLI helpers", () => {
  it("formats a concise latest snapshot summary", () => {
    expect(formatSnapshotSummary(makeSnapshot())).toContain([
      "Session: cli-session",
      "Page: Business Address",
      "URL: https://zoom.us/cpw/page/phoneNumbers#/business-address",
      "Steps: 2 raw / 1 prepared",
      "Quality: 82",
      "Test: idle"
    ].join("\n"));
  });

  it("builds command payloads for full and partial workflow tests", () => {
    expect(buildCommandInput("test", [])).toEqual({ type: "RUN_TEST_WORKFLOW", payload: {} });
    expect(buildCommandInput("test", ["--from", "step-1"])).toEqual({
      type: "RUN_TEST_WORKFLOW_FROM",
      payload: { actionId: "step-1" }
    });
  });

  it("builds an import command from a workflow JSON file", () => {
    const workflowPath = writeWorkflowFile(makeWorkflow());

    expect(buildCommandInput("import", ["--file", workflowPath])).toEqual({
      type: "IMPORT_WORKFLOW",
      payload: { workflow: makeWorkflow() }
    });
  });

  it("builds import and browser-test commands from a workflow JSON file", () => {
    const workflowPath = writeWorkflowFile(makeWorkflow());

    expect(buildCommandInput("test", ["--file", workflowPath])).toEqual({
      type: "IMPORT_AND_RUN_TEST_WORKFLOW",
      payload: { workflow: makeWorkflow() }
    });
    expect(buildCommandInput("test", ["--file", workflowPath, "--from", "save"])).toEqual({
      type: "IMPORT_AND_RUN_TEST_WORKFLOW_FROM",
      payload: { workflow: makeWorkflow(), actionId: "save" }
    });
  });

  it("builds trusted browser-test commands for Chrome debugger input replay", () => {
    const workflowPath = writeWorkflowFile(makeWorkflow());

    expect(buildCommandInput("test", ["--trusted"])).toEqual({
      type: "RUN_TRUSTED_TEST_WORKFLOW",
      payload: {}
    });
    expect(buildCommandInput("test", ["--trusted", "--from", "save"])).toEqual({
      type: "RUN_TRUSTED_TEST_WORKFLOW_FROM",
      payload: { actionId: "save" }
    });
    expect(buildCommandInput("test", ["--trusted", "--file", workflowPath])).toEqual({
      type: "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW",
      payload: { workflow: makeWorkflow() }
    });
    expect(buildCommandInput("test", ["--trusted", "--file", workflowPath, "--from", "save"])).toEqual({
      type: "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW_FROM",
      payload: { workflow: makeWorkflow(), actionId: "save" }
    });
  });

  it("builds command payloads for single-step and selector diagnostics", () => {
    expect(buildCommandInput("step", ["--action", "country"])).toEqual({
      type: "RUN_TEST_ACTION",
      payload: { actionId: "country" }
    });
    expect(buildCommandInput("selector", ["--action", "country"])).toEqual({
      type: "TEST_SELECTOR",
      payload: { actionId: "country" }
    });
  });

  it("builds command payloads for workflow snapshots and clearing actions", () => {
    expect(buildCommandInput("build", [])).toEqual({ type: "BUILD_WORKFLOW", payload: {} });
    expect(buildCommandInput("clear", [])).toEqual({ type: "CLEAR_ACTIONS", payload: {} });
  });

  it("builds a self-reload command for the Chrome extension", () => {
    expect(buildCommandInput("reload-extension", [])).toEqual({
      type: "RELOAD_EXTENSION",
      payload: {}
    });
  });

  it("builds training command payloads with harness options", () => {
    expect(buildCommandInput("train", ["--iterations", "5", "--from", "step-1", "--delay-ms", "250", "--stop-on-failure"]))
      .toEqual({
        type: "RUN_TRAINING_WORKFLOW",
        payload: {
          iterations: 5,
          fromActionId: "step-1",
          delayMs: 250,
          stopOnFailure: true
        }
      });
  });

  it("formats workflow hardening previews for CLI review", () => {
    const preview = buildWorkflowHardeningPreview(makeWorkflow());
    const summary = formatHardeningSummary(preview);

    expect(preview.report.bulkReady).toBe(true);
    expect(summary).toContain("Bulk readiness: ready");
    expect(summary).toContain("Intent: create");
    expect(summary).toContain("Entity: queue");
    expect(summary).toContain("Added guard: create");
    expect(summary).toContain("Added assertion: entityExists");
  });
});

function makeSnapshot(): RecorderDebugSnapshot {
  return {
    sessionId: "cli-session",
    timestamp: "2026-06-07T00:00:00.000Z",
    source: "extension",
    status: { recording: false, paused: false, actionCount: 2 },
    rawActions: [
      { id: "a1", type: "navigate", timestamp: 1, selectors: {}, pageUrl: "https://zoom.us", pageTitle: "Zoom" },
      { id: "a2", type: "click", timestamp: 2, selectors: {}, pageUrl: "https://zoom.us", pageTitle: "Zoom" }
    ],
    preparedActions: [
      { id: "a1", type: "navigate", timestamp: 1, selectors: {}, pageUrl: "https://zoom.us", pageTitle: "Zoom" }
    ],
    quality: {
      score: 82,
      selectorStability: 90,
      assertionCoverage: 70,
      evidenceCoverage: 50,
      riskySteps: 0,
      hardcodedValues: 1,
      unsupportedBrowserPreflightSteps: 0,
      warnings: []
    },
    testState: { running: false, events: [] },
    page: {
      url: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
      title: "Business Address"
    }
  };
}

function writeWorkflowFile(workflow: RecordedWorkflow): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-cli-"));
  const filePath = path.join(dir, "workflow.json");
  writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return filePath;
}

function makeWorkflow(): RecordedWorkflow {
  return {
    version: 1,
    meta: {
      name: "Create Queue",
      description: "raw workflow",
      recordedAt: "2026-06-08T00:00:00.000Z",
      recordedOnUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
      durationMs: 1000,
      category: "custom"
    },
    parameters: [],
    actions: [
      { id: "create", timestamp: 1, type: "click", selectors: { role: { role: "button", name: "Create Queue" } }, pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues", pageTitle: "Queues" },
      { id: "name", timestamp: 2, type: "fill", selectors: { label: "Queue Name" }, value: "Priority Support", pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new", pageTitle: "Queues" },
      { id: "extension", timestamp: 3, type: "fill", selectors: { label: "Extension" }, value: "5001", pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new", pageTitle: "Queues" },
      { id: "save", timestamp: 4, type: "click", selectors: { role: { role: "button", name: "Save" } }, networkWaitUrl: "/api/queues", pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new", pageTitle: "Queues" }
    ],
    assertions: [],
    config: {
      startUrl: "/cpw/page/contactCenter#/queues",
      requiresImpersonation: true,
      defaultTimeout: 10_000,
      retryableErrors: []
    }
  };
}
