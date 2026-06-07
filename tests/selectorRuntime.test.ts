import { describe, expect, it } from "vitest";
import {
  buildSelectorResolutionPlan,
  createSelectorResolutionDiagnostics
} from "../src/runtime/selectors/selectorResolver.js";
import type { SelectorCandidate, SelectorStrategy } from "@zoom-automation/workflow-core";

describe("enterprise selector runtime", () => {
  it("builds a ranked resolution plan from candidates and legacy selectors", () => {
    const selectors: SelectorStrategy = { css: ".zoom-input__inner:nth-child(2)" };
    const candidates: SelectorCandidate[] = [
      { id: "css", kind: "css", selector: { css: ".zoom-input__inner:nth-child(2)" }, source: "recorded" },
      { id: "role-save", kind: "role", selector: { role: { role: "button", name: "Save", exact: true } }, source: "healed" }
    ];

    const plan = buildSelectorResolutionPlan(selectors, candidates);

    expect(plan.map((entry) => entry.candidate.kind)).toEqual(["role", "css"]);
    expect(plan[0].candidate.id).toBe("role-save");
    expect(plan[0].score.level).toBe("high");
  });

  it("records diagnostics for fallback usage and ambiguous matches", () => {
    const diagnostics = createSelectorResolutionDiagnostics({
      requestedStrategies: ["role-save", "css"],
      selectedStrategy: "css",
      selectedRank: 2,
      matchedCount: 4,
      visibleCount: 2,
      elapsedMs: 120,
      warnings: ["Ambiguous: 2 visible matches"]
    });

    expect(diagnostics.fallbackUsed).toBe(true);
    expect(diagnostics.confidence).toBe("medium");
    expect(diagnostics.warnings).toContain("Ambiguous: 2 visible matches");
  });
});
