import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSelectorCandidatesForElement, testSelectorCandidatesInDocument } from "../extension/shared/selectorCandidates.js";

describe("extension selector candidates", () => {
  it("builds and ranks live-tested selector candidates for a select element", () => {
    const dom = new JSDOM(`
      <form>
        <label for="country">Country</label>
        <select id="country" class="zoom-input__inner"><option>Australia</option></select>
      </form>
    `);
    installDomGlobals(dom);
    const select = dom.window.document.querySelector("select")!;

    const candidates = buildSelectorCandidatesForElement(select);
    const ranked = testSelectorCandidatesInDocument(candidates, dom.window.document, select);

    expect(candidates.some((candidate) => candidate.kind === "xpath")).toBe(true);
    expect(ranked[0].kind).toBe("role");
    expect(ranked[0].diagnostics).toEqual(expect.objectContaining({
      matchedCount: 1,
      visibleCount: 1,
      uniquelyIdentifiesTarget: true
    }));
    expect(ranked.find((candidate) => candidate.kind === "xpath")?.diagnostics?.visibleCount).toBe(1);
  });

  it("penalizes broad css candidates when ARIA candidates uniquely identify the target", () => {
    const dom = new JSDOM(`
      <button class="zoom-button">Cancel</button>
      <button class="zoom-button" aria-label="Save">Save</button>
    `);
    installDomGlobals(dom);
    const save = dom.window.document.querySelector("[aria-label='Save']")!;

    const ranked = testSelectorCandidatesInDocument(buildSelectorCandidatesForElement(save), dom.window.document, save);

    expect(ranked[0]).toEqual(expect.objectContaining({
      kind: "role",
      score: expect.objectContaining({ level: "high" })
    }));
    expect(ranked.find((candidate) => candidate.kind === "css")?.score.level).toBe("low");
  });
});

function installDomGlobals(dom: JSDOM): void {
  Object.assign(globalThis, {
    Document: dom.window.Document,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    XPathResult: dom.window.XPathResult
  });
}
