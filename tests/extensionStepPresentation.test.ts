import { describe, expect, it } from "vitest";
import {
  buildStepMiniMap,
  buildBulkPolicyUpdate,
  bulkPolicyTargets,
  describeStep,
  stepPolicyBadges,
  visibleFieldGroups,
  type BulkPolicyTarget
} from "../extension/shared/stepPresentation.js";
import { buildStepInspectorSummary } from "../extension/shared/stepInspector.js";
import type { RecordedAction } from "@zoom-automation/workflow-core";

function action(id: string, overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "click",
    selectors: {},
    pageUrl: "https://zoom.us/x",
    pageTitle: "x",
    ...overrides
  };
}

describe("extension step presentation", () => {
  it("describes common step types for compact headers", () => {
    expect(describeStep(action("nav", { type: "navigate", url: "#/business-address" }))).toBe("Navigate to #/business-address");
    expect(describeStep(action("fill", { type: "fill", selectors: { label: "Company" } }))).toBe("Fill Company");
    expect(describeStep(action("select", { type: "select", value: "Australia" }))).toBe("Select Australia");
    expect(describeStep(action("shot", { type: "screenshot", screenshotLabel: "after-save" }))).toBe("Take screenshot: after-save");
  });

  it("returns visible inline field groups per step type", () => {
    expect(visibleFieldGroups(action("nav", { type: "navigate" }))).toEqual(["policy", "test", "url"]);
    expect(visibleFieldGroups(action("fill", { type: "fill" }))).toEqual(["policy", "test", "selector", "value"]);
    expect(visibleFieldGroups(action("save", { type: "click", selectors: { role: { role: "button", name: "Save" } } }))).toEqual([
      "policy",
      "test",
      "selector",
      "validationSuggestion"
    ]);
    expect(visibleFieldGroups(action("assert", { type: "assert" }))).toEqual(["policy", "test", "selector", "assertion"]);
    expect(visibleFieldGroups(action("wait", { type: "wait" }))).toEqual(["policy", "test", "wait"]);
  });

  it("builds compact policy badges for long workflow scanning", () => {
    const badges = stepPolicyBadges(action("a", {
      timeout: 15_000,
      retryCount: 2,
      condition: { type: "textExistsSkip", text: "already exists" },
      screenshotOnFailure: true,
      continueOnFailure: true
    }));

    expect(badges.map((badge) => badge.label)).toEqual(["15s", "2 retries", "Condition", "Screenshot", "Continue"]);
    expect(badges.find((badge) => badge.kind === "condition")?.title).toContain("already exists");
  });

  it("groups bulk policy targets for common long-workflow edits", () => {
    const steps = [
      action("nav", { type: "navigate" }),
      action("weak-click", { type: "click", selectors: { css: ".save" } }),
      action("stable-fill", { type: "fill", selectors: { label: "Company" } }),
      action("assert", { type: "assert" }),
      action("shot", { type: "screenshot" })
    ];

    const targets = bulkPolicyTargets(steps);
    const byId = (target: BulkPolicyTarget) => target.actionIds;

    expect(byId(targets.allSteps)).toEqual(["nav", "weak-click", "stable-fill", "assert", "shot"]);
    expect(byId(targets.mutatingSteps)).toEqual(["weak-click", "stable-fill"]);
    expect(byId(targets.weakSelectorSteps)).toEqual(["weak-click"]);
  });

  it("builds bulk policy updates without clearing unchecked boolean settings", () => {
    expect(buildBulkPolicyUpdate({
      timeout: "20000",
      retryCount: "",
      retryDelayMs: "",
      enableContinueOnFailure: false,
      enableScreenshotOnFailure: false
    })).toEqual({ timeout: 20_000 });

    expect(buildBulkPolicyUpdate({
      timeout: "",
      retryCount: "2",
      retryDelayMs: "500",
      enableContinueOnFailure: true,
      enableScreenshotOnFailure: true
    })).toEqual({
      retryCount: 2,
      retryDelayMs: 500,
      continueOnFailure: true,
      screenshotOnFailure: true
    });
  });

  it("builds a compact step mini map with risk levels and active state", () => {
    const steps = [
      action("nav", { type: "navigate", url: "https://zoom.us/account" }),
      action("weak-click", { type: "click", selectors: { css: ".save" } }),
      action("save", { type: "click", selectors: { role: { role: "button", name: "Save" } } }),
      action("company", { type: "fill", selectors: { label: "Company" } })
    ];

    const miniMap = buildStepMiniMap(steps, "save");

    expect(miniMap.map((entry) => ({
      actionId: entry.actionId,
      index: entry.index,
      level: entry.level,
      active: entry.active
    }))).toEqual([
      { actionId: "nav", index: 1, level: "manual", active: false },
      { actionId: "weak-click", index: 2, level: "danger", active: false },
      { actionId: "save", index: 3, level: "warning", active: true },
      { actionId: "company", index: 4, level: "ok", active: false }
    ]);
    expect(miniMap[1].title).toContain("#2 Click element");
    expect(miniMap[1].title).toContain("Weak selector");
  });

  it("summarizes step inspector evidence, anchors, live matches, and fallback selectors", () => {
    const summary = buildStepInspectorSummary(action("save", {
      selectors: {
        css: ".zoom-btn:nth-child(3)",
        anchor: { text: "Business address", scopeRole: "row", relationship: "within" }
      },
      selectedCandidateId: "role-save",
      capture: {
        thumbnail: { dataUrl: "data:image/png;base64,abc", width: 320, height: 180 },
        capturedAt: "2026-06-07T00:00:00.000Z",
        pageUrl: "https://zoom.us/x",
        viewport: { width: 1440, height: 900 },
        targetBox: { x: 10, y: 20, width: 100, height: 32 }
      },
      selectorDiagnostics: {
        matchedCount: 3,
        visibleCount: 1,
        chosenCandidateId: "role-save",
        confidence: { score: 86, level: "high", reasons: ["Unique visible match"] },
        targetPreview: "<button Save>",
        anchor: { text: "Business address", scopeRole: "row", relationship: "within", resolved: true }
      },
      selectorCandidates: [
        { id: "css-save", kind: "css", selector: { css: ".zoom-btn:nth-child(3)" }, label: "CSS fallback" },
        { id: "role-save", kind: "role", selector: { role: { role: "button", name: "Save" } }, label: "Button Save" }
      ]
    }));

    expect(summary.hasThumbnail).toBe(true);
    expect(summary.thumbnail?.width).toBe(320);
    expect(summary.anchorLabel).toBe('within row containing "Business address"');
    expect(summary.matchLabel).toBe("3 matched, 1 visible");
    expect(summary.confidenceLabel).toBe("86/100 high");
    expect(summary.chosenSelectorLabel).toBe("Button Save");
    expect(summary.fallbackCount).toBe(1);
  });
});
