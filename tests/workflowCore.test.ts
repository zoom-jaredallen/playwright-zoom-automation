import { describe, expect, it } from "vitest";
import {
  applyStepUpdate,
  buildWorkflow,
  calculateQualityReport,
  deleteStep,
  detectParameters,
  generateAssertions,
  insertStep,
  makeAssertionAction,
  makeNavigationAction,
  makeWaitAction,
  moveStep,
  normalizeNavigationUrl,
  parseWorkflow,
  safeParseWorkflow,
  sanitizeAction,
  setParameterConfirmed,
  updateStep,
  type RecordedAction
} from "@zoom-automation/workflow-core";

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

describe("model — array mutations", () => {
  it("moves a step up and down", () => {
    const list = [action("a"), action("b"), action("c")];
    expect(moveStep(list, "c", "up").map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(moveStep(list, "a", "down").map((s) => s.id)).toEqual(["b", "a", "c"]);
    // no-op at the boundary, returns same reference
    expect(moveStep(list, "a", "up")).toBe(list);
  });

  it("deletes a step without mutating the input", () => {
    const list = [action("a"), action("b")];
    expect(deleteStep(list, "a").map((s) => s.id)).toEqual(["b"]);
    expect(list).toHaveLength(2);
  });

  it("inserts after a given id, at the front (null), and at the end (undefined)", () => {
    const list = [action("a"), action("b")];
    expect(insertStep(list, action("x"), "a").map((s) => s.id)).toEqual(["a", "x", "b"]);
    expect(insertStep(list, action("x"), null).map((s) => s.id)).toEqual(["x", "a", "b"]);
    expect(insertStep(list, action("x")).map((s) => s.id)).toEqual(["a", "b", "x"]);
  });

  it("applies and clamps field updates immutably", () => {
    const original = action("a", { type: "assert", assertionType: "textVisible" });
    const updated = applyStepUpdate(original, { timeout: 9_999_999, retryCount: 99, expected: "  Saved  " });
    expect(updated).not.toBe(original);
    expect(updated.timeout).toBe(60_000); // clamped
    expect(updated.retryCount).toBe(10); // clamped
    expect(updated.expected).toBe("Saved"); // trimmed
    expect(original.timeout).toBeUndefined(); // input untouched
  });

  it("updateStep only touches the targeted action", () => {
    const list = [action("a", { description: "one" }), action("b", { description: "two" })];
    const next = updateStep(list, "b", { description: "changed" });
    expect(next.find((s) => s.id === "a")?.description).toBe("one");
    expect(next.find((s) => s.id === "b")?.description).toBe("changed");
  });

  it("toggles a parameter hint's confirmed flag", () => {
    const list = [action("a", { parameterHints: [{ originalValue: "x", suggestedName: "p", reason: "looks_like_name" }] })];
    const next = setParameterConfirmed(list, "a", 0, false);
    expect(next[0].parameterHints?.[0].confirmed).toBe(false);
  });
});

describe("model — factories", () => {
  it("normalizes navigation URLs", () => {
    expect(normalizeNavigationUrl("/cpw/x")).toBe("https://zoom.us/cpw/x");
    expect(normalizeNavigationUrl("#/business-address")).toBe("https://zoom.us/cpw/page/phoneNumbers#/business-address");
    expect(normalizeNavigationUrl("https://zoom.us/y")).toBe("https://zoom.us/y");
  });

  it("creates typed manual steps", () => {
    expect(makeNavigationAction("/x").type).toBe("navigate");
    expect(makeWaitAction(100).waitMs).toBe(250); // clamped to min
    expect(makeAssertionAction("hasText", "ok").assertionType).toBe("hasText");
  });
});

describe("analysis — quality report (regression-locked)", () => {
  it("scores a single stable submit click with no assertion", () => {
    const steps = [action("a", { type: "click", selectors: { role: { role: "button", name: "Save" } } })];
    const report = calculateQualityReport(steps, generateAssertions(steps).filter((a) => a.afterAction !== "a" || a.type !== "textVisible"));
    // selectorStability 100, assertionCoverage 0 (1 submit, 0 matching assert passed in), evidence 0
    expect(report.selectorStability).toBe(100);
    expect(report.score).toBe(50);
    expect(report.warnings).toContain("Add validations after important submit/save actions.");
    expect(report.warnings).toContain("Add screenshots for evidence and failure diagnosis.");
  });
});

describe("analysis — parameter detection", () => {
  it("detects phone, email, and country values", () => {
    expect(detectParameters("+61 2 1234 5678", { label: "Contact Number" })[0]?.suggestedName).toBe("contact.number");
    expect(detectParameters("a@b.com", { label: "Contact Email" })[0]?.suggestedName).toBe("contact.email");
    expect(detectParameters("Australia", {})[0]?.suggestedName).toBe("address.country");
  });
});

describe("model — buildWorkflow (deterministic)", () => {
  it("builds a consistent workflow given a fixed clock", () => {
    const steps = [
      makeNavigationAction("#/business-address"),
      action("fill1", { type: "fill", value: "+61 2 1234 5678", selectors: { label: "Contact Number" }, parameterHints: [{ originalValue: "+61 2 1234 5678", suggestedName: "contact.number", reason: "looks_like_phone_number" }] }),
      action("save", { type: "click", selectors: { role: { role: "button", name: "Save" } } })
    ];
    const workflow = buildWorkflow({
      actions: steps,
      recordingStartUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
      recordingStartTime: 1_000,
      impersonationDetected: true,
      nowMs: 6_000
    });
    expect(workflow.meta.durationMs).toBe(5_000);
    expect(workflow.meta.recordedAt).toBe(new Date(6_000).toISOString());
    expect(workflow.config.requiresImpersonation).toBe(true);
    // The phone value is replaced with its parameter placeholder
    expect(workflow.actions.find((a) => a.id === "fill1")?.value).toBe("{{contact.number}}");
    expect(workflow.parameters.some((p) => p.name === "contact.number")).toBe(true);
    expect(workflow.quality).toBeDefined();
  });
});

describe("model — sanitizeAction", () => {
  it("normalizes a relative navigate URL", () => {
    const a = action("n", { type: "navigate", url: "#/business-address" });
    expect(sanitizeAction(a).url).toBe("https://zoom.us/cpw/page/phoneNumbers#/business-address");
  });

  it("strips fields that don't apply after a type change", () => {
    // An assert step switched to a click should not keep assert-only fields.
    const a = action("x", { type: "click", assertionType: "textVisible", expected: "Saved", waitMs: 500, url: "https://zoom.us/y" });
    const cleaned = sanitizeAction(a);
    expect(cleaned.assertionType).toBeUndefined();
    expect(cleaned.expected).toBeUndefined();
    expect(cleaned.waitMs).toBeUndefined();
    expect(cleaned.url).toBeUndefined(); // url only valid on navigate
  });

  it("keeps fields relevant to the action's type", () => {
    const a = action("f", { type: "fill", value: "hi" });
    expect(sanitizeAction(a).value).toBe("hi");
  });
});

describe("schema — validation", () => {
  const valid = {
    version: 1,
    meta: { name: "n", description: "d", recordedAt: "t", recordedOnUrl: "u", durationMs: 1, category: "custom" },
    parameters: [],
    actions: [{ id: "a", timestamp: 0, type: "click", selectors: {}, pageUrl: "u", pageTitle: "t" }],
    assertions: [],
    config: { startUrl: "/x", requiresImpersonation: true, defaultTimeout: 10000, retryableErrors: [] }
  };

  it("accepts a valid workflow", () => {
    expect(() => parseWorkflow(valid)).not.toThrow();
    expect(safeParseWorkflow(valid).success).toBe(true);
  });

  it("rejects a workflow with no actions", () => {
    const result = safeParseWorkflow({ ...valid, actions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a non-workflow payload with a readable error", () => {
    const result = safeParseWorkflow({ nope: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Invalid workflow");
  });
});
