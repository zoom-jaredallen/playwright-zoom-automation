import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSelectorCandidatesForElement, resolveSelectorCandidate, testSelectorCandidatesInDocument } from "../extension/shared/selectorCandidates.js";
import { computeAnchor } from "../extension/shared/selectors.js";

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

  it("captures dialog anchors for controls inside repeated modal surfaces", () => {
    const dom = new JSDOM(`
      <div role="dialog" aria-label="Add user">
        <label for="role">Role</label>
        <select id="role"><option>Admin</option></select>
      </div>
    `);
    installDomGlobals(dom);
    const select = dom.window.document.querySelector("select")!;

    const candidates = buildSelectorCandidatesForElement(select);

    expect(candidates[0].selector.anchor).toEqual(expect.objectContaining({
      text: "Add user",
      scopeRole: "dialog",
      scopeSelector: "[role='dialog'], dialog",
      relationship: "within"
    }));
  });

  it("captures CPZUI form-field anchors from adjacent form labels", () => {
    const dom = new JSDOM(`
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper cpzui-form-item--md">
          <div class="cpzui-form-item__label-content">
            <span id="cpzui-id-9860-324" class="cpzui-form-item__label">State/Province/Territory</span>
            <span aria-hidden="true" class="cpzui-form-item__asterisk">*</span>
          </div>
        </div>
        <div class="cpzui-form-item__widgets">
          <div class="cpzui-input cpzui-input--md cp-w-55md">
            <input class="cpzui-input__inner" type="text" aria-labelledby="cpzui-id-9860-324" aria-label="State/Province/Territory" placeholder="Enter">
          </div>
        </div>
      </div>
    `);
    installDomGlobals(dom);
    const input = dom.window.document.querySelector("input")!;

    expect(computeAnchor(input)).toEqual(expect.objectContaining({
      text: "State/Province/Territory",
      scopeSelector: ".cpzui-form-item__row",
      relationship: "nearControl",
      kind: "formField"
    }));
  });

  it("scopes selector candidates to the matching CPZUI form-field row", () => {
    const dom = new JSDOM(`
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper"><span class="cpzui-form-item__label">City</span></div>
        <div class="cpzui-form-item__widgets"><input class="cpzui-input__inner" type="text" aria-label="City"></div>
      </div>
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper"><span class="cpzui-form-item__label">State/Province/Territory</span></div>
        <div class="cpzui-form-item__widgets"><input class="cpzui-input__inner" type="text" aria-label="State/Province/Territory"></div>
      </div>
    `);
    installDomGlobals(dom);
    const stateInput = dom.window.document.querySelector("input[aria-label='State/Province/Territory']")!;

    const anchor = computeAnchor(stateInput);
    const matches = resolveSelectorCandidate({
      css: ".cpzui-input__inner",
      anchor
    }, dom.window.document);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(stateInput);
  });

  it("records when automatic context narrows an ambiguous direct selector", () => {
    const dom = new JSDOM(`
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper"><span class="cpzui-form-item__label">City</span></div>
        <div class="cpzui-form-item__widgets"><input class="cpzui-input__inner" type="text" aria-label="City"></div>
      </div>
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper"><span class="cpzui-form-item__label">State/Province/Territory</span></div>
        <div class="cpzui-form-item__widgets"><input class="cpzui-input__inner" type="text" aria-label="State/Province/Territory"></div>
      </div>
    `);
    installDomGlobals(dom);
    const stateInput = dom.window.document.querySelector("input[aria-label='State/Province/Territory']")!;

    const anchor = computeAnchor(stateInput);
    const ranked = testSelectorCandidatesInDocument([{
      id: "css-input",
      kind: "css",
      selector: { css: ".cpzui-input__inner", anchor },
      source: "manual",
      label: ".cpzui-input__inner"
    }], dom.window.document, stateInput);
    const cssCandidate = ranked[0];

    expect(cssCandidate.diagnostics?.context).toEqual(expect.objectContaining({
      appliedAutomatically: true,
      mode: "primary",
      directVisibleCount: 2,
      contextVisibleCount: 1,
      reason: "Context narrowed 2 visible matches to 1"
    }));
    expect(cssCandidate.diagnostics?.anchorReducedMatches).toBe(true);
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
