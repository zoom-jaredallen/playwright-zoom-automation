import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildZoomComboboxSelection, normalizeZoomOptionText } from "../extension/shared/zoomCombobox.js";
import { extractSelectors, getFieldContext } from "../extension/shared/selectors.js";

describe("extension Zoom combobox recording", () => {
  it("records the closed combobox as the select target and the clicked option as metadata", () => {
    const dom = new JSDOM(`
      <div class="cpzui-form-item__row">
        <span class="cpzui-form-item__label">Product</span>
        <div class="cpzui-select" role="combobox" aria-label="Product" aria-expanded="true">
          <span>Phone</span>
        </div>
      </div>
      <ul role="listbox" class="cpzui-select-dropdown">
        <li class="cpzui-select-option" role="option">Phone</li>
        <li class="cpzui-select-option" role="option">
          <div><div><div>Contact Center</div></div></div>
        </li>
      </ul>
    `);
    installDomGlobals(dom);
    const trigger = dom.window.document.querySelector("[role='combobox']")!;
    const option = Array.from(dom.window.document.querySelectorAll("[role='option']")).at(1)!;

    const selection = buildZoomComboboxSelection({
      triggerElement: trigger,
      optionElement: option,
      optionText: "Contact Center",
      label: "Product"
    });

    expect(selection.selectors).toEqual(expect.objectContaining({
      role: { role: "combobox", name: "Product" },
      anchor: expect.objectContaining({ text: "Product", kind: "formField" })
    }));
    expect(selection.selectorCandidates[0]).toEqual(expect.objectContaining({
      id: "role-combobox-product",
      selector: expect.objectContaining({ role: { role: "combobox", name: "Product" } })
    }));
    expect(selection.selectedCandidateId).toBe("role-combobox-product");
    expect(selection.selectMetadata.optionLabel).toBe("Contact Center");
    expect(selection.selectMetadata.optionCandidates?.[0]).toEqual(expect.objectContaining({
      id: "role-option-contact-center",
      selector: { role: { role: "option", name: "Contact Center", exact: true } }
    }));
    expect(selection.selectMetadata.optionCandidates?.some((candidate) => candidate.id === "label-phone")).toBe(false);
  });

  it("normalizes multi-line Zoom option text to the accessible option label", () => {
    const dom = new JSDOM(`
      <li class="cpzui-select-option" role="option">
        <div class="cpzui-select-option__content">
          <div>Virtual Service</div>
          <div>Incoming Call · Outgoing Call</div>
        </div>
      </li>
    `);
    installDomGlobals(dom);
    const option = dom.window.document.querySelector("[role='option']")!;

    expect(normalizeZoomOptionText(option)).toBe("Virtual Service - Incoming Call · Outgoing Call");
  });

  it("prefers the Zoom form row label over generic searchable-select input instructions", () => {
    const dom = new JSDOM(`
      <div class="cpzui-form-item__row">
        <div class="cpzui-form-item__label-wrapper cpzui-form-item--md">
          <div class="cpzui-form-item__label-content">
            <span id="field-label" class="cpzui-form-item__label">Country/Region</span>
            <span aria-hidden="true" class="cpzui-form-item__asterisk">*</span>
          </div>
        </div>
        <div class="cpzui-form-item__widgets">
          <div class="cpzui-virtual-filter-select cpzui-select" role="combobox">
            <input
              class="cpzui-input__inner"
              type="text"
              aria-labelledby="field-label"
              aria-label="Select or Enter"
              placeholder="Select or Enter"
            />
          </div>
        </div>
      </div>
    `);
    installDomGlobals(dom);
    const trigger = dom.window.document.querySelector(".cpzui-virtual-filter-select")!;

    expect(extractSelectors(trigger).role).toEqual({ role: "combobox", name: "Country/Region" });
    expect(getFieldContext(trigger).label).toBe("Country/Region");
  });

  it("keeps single-line Zoom option text unchanged", () => {
    const dom = new JSDOM(`
      <li class="cpzui-select-option" role="option">
        <div class="cpzui-select-option__content">
          <div><div><div>Contact Center</div></div></div>
        </div>
      </li>
    `);
    installDomGlobals(dom);
    const option = dom.window.document.querySelector("[role='option']")!;

    expect(normalizeZoomOptionText(option)).toBe("Contact Center");
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
