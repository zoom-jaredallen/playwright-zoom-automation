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
  makeClickAction,
  makeDismissAction,
  makeFillAction,
  makeNavigationAction,
  makePressAction,
  makeSelectAction,
  makeWaitAction,
  moveStep,
  normalizeNavigationUrl,
  parseWorkflow,
  safeParseWorkflow,
  sanitizeAction,
  setParameterConfirmed,
  updateStep,
  scoreSelector,
  makeIfBlock,
  insertIntoBranch,
  flattenActions,
  setStepGuard,
  selectorCandidatesFromStrategy,
  rankSelectorCandidates,
  scoreSelectorCandidate,
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

  it("updates value fields on fill/select steps", () => {
    expect(applyStepUpdate(action("f", { type: "fill", value: "" }), { value: "  Jared  " }).value).toBe("Jared");
    expect(applyStepUpdate(action("s", { type: "select", value: "" }), { value: "  Australia  " }).value).toBe("Australia");
  });

  it("updates timeout policy on non-assert steps", () => {
    expect(applyStepUpdate(action("c", { type: "click" }), { timeout: 15_000 }).timeout).toBe(15_000);
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
    expect(makeClickAction("https://zoom.us/x").type).toBe("click");
    expect(makeFillAction("hello").value).toBe("hello");
    expect(makeSelectAction("Australia").value).toBe("Australia");
    expect(makePressAction().key).toBe("Enter");
    expect(makeWaitAction(100).waitMs).toBe(250); // clamped to min
    expect(makeAssertionAction("hasText", "ok").assertionType).toBe("hasText");
    expect(makeDismissAction().type).toBe("dismiss");
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

describe("analysis — assertion generation", () => {
  it("does not treat Add user modal openers as success-toast commits", () => {
    const steps = [
      action("open-add-user", { type: "click", selectors: { role: { role: "button", name: "Add user" } } }),
      action("save", { type: "click", selectors: { role: { role: "button", name: "Save" } } })
    ];

    const assertions = generateAssertions(steps);

    expect(assertions.some((assertion) => assertion.afterAction === "open-add-user")).toBe(false);
    expect(assertions.some((assertion) => assertion.afterAction === "save" && assertion.type === "textVisible")).toBe(true);
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

describe("confidence — scoreSelector", () => {
  it("rates a test id as high and css-only as low", () => {
    expect(scoreSelector({ testId: "save-btn" }).level).toBe("high");
    expect(scoreSelector({ css: ".btn > span" }).level).toBe("low");
  });

  it("penalizes nth and rewards anchors", () => {
    const withNth = scoreSelector({ role: { role: "button", name: "Save" }, nth: 3 }).score;
    const withAnchor = scoreSelector({ role: { role: "button", name: "Save" }, anchor: { text: "michael.chen", scopeRole: "row" } }).score;
    const plain = scoreSelector({ role: { role: "button", name: "Save" } }).score;
    expect(withNth).toBeLessThan(plain);
    expect(withAnchor).toBeGreaterThan(plain);
  });

  it("returns low with a reason when nothing was captured", () => {
    const result = scoreSelector({});
    expect(result.level).toBe("low");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("selectors — candidate model", () => {
  it("converts legacy selector strategies into ranked candidates", () => {
    const candidates = selectorCandidatesFromStrategy({
      role: { role: "combobox", name: "Country" },
      label: "Country",
      css: ".cpzui-select"
    });

    expect(candidates.map((candidate) => candidate.kind)).toEqual(["role", "label", "css"]);
    expect(candidates[0]).toEqual(expect.objectContaining({
      id: "role-combobox-country",
      selector: { role: { role: "combobox", name: "Country" } },
      source: "legacy"
    }));
  });

  it("scores live-tested unique accessible selectors above broad css selectors", () => {
    const roleScore = scoreSelectorCandidate({
      id: "role",
      kind: "role",
      selector: { role: { role: "combobox", name: "Country", exact: true } },
      diagnostics: { matchedCount: 1, visibleCount: 1, uniquelyIdentifiesTarget: true, anchorReducedMatches: true }
    });
    const cssScore = scoreSelectorCandidate({
      id: "css",
      kind: "css",
      selector: { css: ".zoom-input__inner:nth-child(2)" },
      diagnostics: { matchedCount: 8, visibleCount: 4, uniquelyIdentifiesTarget: false }
    });

    expect(roleScore.score).toBeGreaterThan(cssScore.score);
    expect(roleScore.level).toBe("high");
    expect(cssScore.level).toBe("low");
  });

  it("ranks selector candidates by confidence and preserves fallback order for ties", () => {
    const ranked = rankSelectorCandidates([
      { id: "css", kind: "css", selector: { css: ".zoom-input__inner" }, diagnostics: { matchedCount: 4, visibleCount: 4 } },
      { id: "label", kind: "label", selector: { label: "Country" }, diagnostics: { matchedCount: 1, visibleCount: 1 } },
      { id: "role", kind: "role", selector: { role: { role: "combobox", name: "Country" } }, diagnostics: { matchedCount: 1, visibleCount: 1 } }
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual(["role", "label", "css"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].score.score).toBeGreaterThan(ranked[2].score.score);
  });
});

describe("model — IF blocks (recursive)", () => {
  function tree(): RecordedAction[] {
    const ifBlock = makeIfBlock({ kind: "textVisible", text: "Pending" });
    ifBlock.id = "if1";
    ifBlock.thenActions = [action("t1", { description: "then-1" })];
    ifBlock.elseActions = [action("e1", { description: "else-1" })];
    return [action("a"), ifBlock, action("b")];
  }

  it("flattens depth-first through then/else branches", () => {
    expect(flattenActions(tree()).map((s) => s.id)).toEqual(["a", "if1", "t1", "e1", "b"]);
  });

  it("inserts a step into a specific branch", () => {
    const next = insertIntoBranch(tree(), "if1", "then", action("t2", { description: "then-2" }));
    const ifNode = next.find((s) => s.id === "if1");
    expect(ifNode?.thenActions?.map((s) => s.id)).toEqual(["t1", "t2"]);
  });

  it("deletes, moves, and updates a nested step by id", () => {
    let next = updateStep(tree(), "t1", { description: "renamed" });
    expect(next.find((s) => s.id === "if1")?.thenActions?.[0].description).toBe("renamed");

    const withTwo = insertIntoBranch(next, "if1", "then", action("t2"));
    next = moveStep(withTwo, "t2", "up");
    expect(next.find((s) => s.id === "if1")?.thenActions?.map((s) => s.id)).toEqual(["t2", "t1"]);

    next = deleteStep(next, "t1");
    expect(next.find((s) => s.id === "if1")?.thenActions?.map((s) => s.id)).toEqual(["t2"]);
  });

  it("sets a step guard anywhere in the tree", () => {
    const next = setStepGuard(tree(), "e1", { kind: "urlContains", text: "#/x" }, "skipAccount");
    const guarded = flattenActions(next).find((s) => s.id === "e1");
    expect(guarded?.guard).toEqual({ kind: "urlContains", text: "#/x" });
    expect(guarded?.guardElse).toBe("skipAccount");
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

  it("accepts a nested IF block with a compound predicate", () => {
    const ifAction = {
      id: "if1", timestamp: 1, type: "if", selectors: {}, pageUrl: "u", pageTitle: "t",
      ifCondition: { kind: "and", operands: [{ kind: "textVisible", text: "Pending" }, { kind: "urlContains", text: "#/x" }] },
      thenActions: [{ id: "t1", timestamp: 2, type: "click", selectors: { role: { role: "button", name: "Save" } }, pageUrl: "u", pageTitle: "t" }],
      elseActions: []
    };
    expect(safeParseWorkflow({ ...valid, actions: [ifAction] }).success).toBe(true);
  });

  it("rejects a malformed predicate", () => {
    const bad = { ...valid, actions: [{ ...valid.actions[0], guard: { kind: "and" } }] }; // missing operands
    expect(safeParseWorkflow(bad).success).toBe(false);
  });
});
