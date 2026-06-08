import { describe, expect, it } from "vitest";
import { normalizeForOptionMatch, optionTextMatches, selectedOptionValueMatches } from "../extension/shared/replayOptionMatching.js";

describe("extension replay option matching", () => {
  it("matches Zoom option text across punctuation and spacing differences", () => {
    expect(optionTextMatches("Sydney - , New South Wales", "Sydney , New South Wales")).toBe(true);
    expect(optionTextMatches("9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia", "9 Castlereagh St, Level 1Sydney, NSW 2000, Australia")).toBe(true);
  });

  it("rejects stale virtual-list candidates with the wrong primary option text", () => {
    expect(optionTextMatches("Sydney - , New South Wales", "Alectown , New South Wales")).toBe(false);
  });

  it("accepts selected display values that only show the primary option text", () => {
    expect(selectedOptionValueMatches("Sydney - , New South Wales", "Sydney")).toBe(true);
    expect(selectedOptionValueMatches("9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia", "9 Castlereagh St, Level 1")).toBe(true);
    expect(selectedOptionValueMatches("Sydney - , New South Wales", "Alectown")).toBe(false);
  });

  it("normalizes punctuation for diagnostics", () => {
    expect(normalizeForOptionMatch("Sydney - , New South Wales")).toBe("sydney new south wales");
  });
});
