import { describe, expect, it } from "vitest";
import { buildCommandInput, formatSnapshotSummary } from "../src/recorderDebug/cli.js";
import type { RecorderDebugSnapshot } from "../src/recorderDebug/types.js";

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

  it("builds command payloads for workflow snapshots and clearing actions", () => {
    expect(buildCommandInput("build", [])).toEqual({ type: "BUILD_WORKFLOW", payload: {} });
    expect(buildCommandInput("clear", [])).toEqual({ type: "CLEAR_ACTIONS", payload: {} });
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
