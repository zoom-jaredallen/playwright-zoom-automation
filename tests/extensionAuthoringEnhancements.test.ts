import { describe, expect, it } from "vitest";
import { createStepTestPlan } from "../extension/shared/testPlan.js";
import { applySelectorCandidate, preferredSelectorCandidates } from "../extension/shared/selectorRepair.js";
import { createPublishReview } from "../extension/shared/publishReview.js";
import { buildConditionPreset, suggestParameterReplacements } from "../extension/shared/authoringAssistants.js";
import type { RecordedAction } from "@zoom-automation/workflow-core";

function action(id: string, overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "click",
    selectors: {},
    pageUrl: "https://zoom.us",
    pageTitle: "Zoom",
    ...overrides
  };
}

describe("extension step test plans", () => {
  it("creates full, single-step, and from-step plans", () => {
    const actions = [action("a"), action("b"), action("c")];
    expect(createStepTestPlan(actions, { mode: "full" }).actions.map((step) => step.id)).toEqual(["a", "b", "c"]);
    expect(createStepTestPlan(actions, { mode: "single", actionId: "b" }).actions.map((step) => step.id)).toEqual(["b"]);
    expect(createStepTestPlan(actions, { mode: "from", actionId: "b" }).actions.map((step) => step.id)).toEqual(["b", "c"]);
  });
});

describe("selector repair helpers", () => {
  it("applies a candidate while preserving an existing anchor", () => {
    const repaired = applySelectorCandidate(
      { role: { role: "button", name: "Save" }, anchor: { text: "Billing", scopeRole: "row" } },
      { css: ".save-button" }
    );
    expect(repaired).toEqual({
      css: ".save-button",
      anchor: { text: "Billing", scopeRole: "row" }
    });
  });

  it("orders candidates by preferred strategy", () => {
    const candidates = preferredSelectorCandidates([
      { id: "css", kind: "css", selector: { css: ".x" } },
      { id: "role", kind: "role", selector: { role: { role: "button", name: "Save" } } },
      { id: "xpath", kind: "xpath", selector: { xpath: "//button" } }
    ], "aria");
    expect(candidates.map((candidate) => candidate.id)).toEqual(["role", "css", "xpath"]);
  });
});

describe("publish review", () => {
  it("blocks risky workflow publication until warnings are accepted", () => {
    const review = createPublishReview({
      quality: { score: 55, selectorStability: 40, assertionCoverage: 20, evidenceCoverage: 0, riskySteps: 2, hardcodedValues: 1, unsupportedBrowserPreflightSteps: 0, warnings: [] },
      warningsAccepted: false
    });
    expect(review.publishable).toBe(false);
    expect(review.warnings).toContain("Selector stability is below 70%.");
    expect(createPublishReview({ quality: review.quality, warningsAccepted: true }).publishable).toBe(true);
  });
});

describe("authoring assistants", () => {
  it("suggests parameter replacements for hardcoded values", () => {
    const suggestions = suggestParameterReplacements([
      action("fill", { type: "fill", value: "admin@example.com" }),
      action("assert", { type: "assert", expected: "Saved" })
    ]);
    expect(suggestions[0]).toEqual(expect.objectContaining({
      actionId: "fill",
      originalValue: "admin@example.com",
      suggestedName: "contact.email"
    }));
  });

  it("builds condition presets using the existing step condition schema", () => {
    expect(buildConditionPreset("address-exists-skip-account", { text: "2 Central Blvd" })).toEqual({
      type: "addressAlreadyExistsSkipAccount",
      text: "2 Central Blvd"
    });
  });
});
