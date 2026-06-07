import { describe, expect, it } from "vitest";
import { formatSelectorCandidateLabel, selectorCandidateScoreClass } from "../extension/shared/selectorCandidateLabels.js";

describe("selector candidate labels", () => {
  it("includes selector kind, score, and match counts", () => {
    const label = formatSelectorCandidateLabel({
      selector: { role: { role: "button", name: "Save" } },
      label: "Role: button / Save",
      matchedCount: 1,
      visibleCount: 1,
      kind: "role",
      score: 96,
      scoreLevel: "high"
    });

    expect(label).toBe("Role: button / Save · role · 96 · 1/1 visible");
  });

  it("maps score levels to stable CSS classes", () => {
    expect(selectorCandidateScoreClass("high")).toBe("selector-score high");
    expect(selectorCandidateScoreClass("medium")).toBe("selector-score medium");
    expect(selectorCandidateScoreClass("low")).toBe("selector-score low");
    expect(selectorCandidateScoreClass(undefined)).toBe("selector-score unknown");
  });
});
