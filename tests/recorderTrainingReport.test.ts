import { describe, expect, it } from "vitest";
import type { RecordedAction } from "@zoom-automation/workflow-core";
import {
  buildRecorderTrainingReport,
  buildWorkflowAudit,
  diffRecordedActions,
  formatTrainingReportSummary
} from "../src/recorderDebug/trainingReport.js";

describe("recorder training report", () => {
  it("summarizes training iterations, step health, score, and recommendations", () => {
    const report = buildRecorderTrainingReport({
      sessionId: "training-session",
      workflowName: "Australian business address",
      startedAt: "2026-06-07T00:00:00.000Z",
      finishedAt: "2026-06-07T00:00:10.000Z",
      actions: [
        action("select-country", "select", "Select Australia in Country/Region"),
        action("save", "click", "Click \"Save\"")
      ],
      iterations: [
        {
          index: 1,
          ok: true,
          durationMs: 4_000,
          events: [
            event("success", "Passed: Select Australia in Country/Region", "select-country"),
            event("success", "Passed: Click \"Save\"", "save")
          ]
        },
        {
          index: 2,
          ok: false,
          durationMs: 6_000,
          failedActionId: "select-country",
          error: "locator timed out",
          events: [
            event("error", "locator timed out", "select-country")
          ]
        }
      ],
      qualityScore: 70
    });

    expect(report.summary).toMatchObject({
      iterations: 2,
      passed: 1,
      failed: 1,
      completionRate: 50,
      score: expect.any(Number)
    });
    expect(report.stepHealth).toContainEqual(expect.objectContaining({
      actionId: "select-country",
      attempts: 2,
      failures: 1,
      failureRate: 50,
      lastError: "locator timed out"
    }));
    expect(report.recommendations.some((item) => item.includes("select-country"))).toBe(true);
    expect(formatTrainingReportSummary(report)).toContain("Training score:");
  });

  it("audits workflow structure for recorder quality issues", () => {
    const audit = buildWorkflowAudit({
      rawActions: [
        action("fill-company", "fill", "Fill \"Customer Name\" with \"Zoom Communications Ltd\"", {
          value: "Zoom Communications Ltd",
          selectors: { css: "input.cpzui-input__inner" }
        }),
        action("save", "click", "Click \"Save\"")
      ],
      preparedActions: [
        action("fill-company", "fill", "Fill \"Customer Name\" with \"Zoom Communications Ltd\"", {
          value: "Zoom Communications Ltd",
          selectors: { css: "input.cpzui-input__inner" }
        }),
        action("save", "click", "Click \"Save\"")
      ],
      qualityScore: 62
    });

    expect(audit.score).toBeLessThan(80);
    expect(audit.riskySteps).toContainEqual(expect.objectContaining({ actionId: "fill-company" }));
    expect(audit.recommendations).toEqual(expect.arrayContaining([
      expect.stringMatching(/parameter/i)
    ]));
  });

  it("diffs raw and prepared actions to show collapsed recorder noise", () => {
    const diff = diffRecordedActions({
      rawActions: [
        action("line1-a", "fill", "Fill \"Address Line 1\" with \"9 Castlereagh St\""),
        action("line1-b", "fill", "Fill \"Address Line 1\" with \"9 Castlereagh St\""),
        action("save", "click", "Click \"Save\"")
      ],
      preparedActions: [
        action("line1-a", "fill", "Fill \"Address Line 1\" with \"9 Castlereagh St\""),
        action("save", "click", "Click \"Save\"")
      ]
    });

    expect(diff.rawCount).toBe(3);
    expect(diff.preparedCount).toBe(2);
    expect(diff.removed).toEqual([expect.objectContaining({ id: "line1-b" })]);
  });
});

function action(
  id: string,
  type: RecordedAction["type"],
  description: string,
  overrides: Partial<RecordedAction> = {}
): RecordedAction {
  return {
    id,
    type,
    description,
    timestamp: 1,
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
    pageTitle: "Business Address",
    ...overrides
  };
}

function event(level: "info" | "success" | "error", message: string, actionId?: string) {
  return { timestamp: 1, level, message, actionId };
}
