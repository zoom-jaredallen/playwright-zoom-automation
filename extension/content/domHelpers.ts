import { normalizeZoomOptionText } from "../shared/zoomCombobox.js";

export const CHECKBOX_TARGET_SELECTOR = [
  'input[type="checkbox"]',
  '[role="checkbox"]',
  'label:has(input[type="checkbox"])',
  '[class*="checkbox"]',
  '[class*="Checkbox"]',
  '[class*="cpzui-checkbox"]',
  '[class*="zm-checkbox"]',
  '[class*="zmu-checkbox"]'
].join(",");

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => boolean, timeout: number, errorMessage: string | (() => string)): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(typeof errorMessage === "function" ? errorMessage() : errorMessage);
}

export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

export function visibleText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function normalizeReplayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function highlightElement(element: Element): void {
  const id = "__zoom_recorder_selector_highlight";
  document.getElementById(id)?.remove();
  const rect = element.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.id = id;
  overlay.style.cssText = [
    "position: fixed",
    `left: ${Math.max(rect.left - 3, 0)}px`,
    `top: ${Math.max(rect.top - 3, 0)}px`,
    `width: ${Math.max(rect.width + 6, 6)}px`,
    `height: ${Math.max(rect.height + 6, 6)}px`,
    "border: 3px solid #0b5cff",
    "box-shadow: 0 0 0 3px rgba(11,92,255,0.2)",
    "border-radius: 6px",
    "z-index: 999998",
    "pointer-events: none"
  ].join(";");
  document.body.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), 2_500);
}

export function elementPreview(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? visibleText(element);
  return `<${tag}> ${label.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

export function findByLabel(labelText: string, root: ParentNode = document): Element | undefined {
  const needle = normalizeReplayText(labelText).toLowerCase();
  const labels = Array.from(root.querySelectorAll("label"));
  for (const label of labels) {
    if (!elementAccessibleText(label).toLowerCase().includes(needle)) continue;
    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target && isElementVisible(target)) return target;
    }
    const nested = label.querySelector("input, textarea, select, button, [role='button'], [role='checkbox'], [role='combobox']");
    if (nested && isElementVisible(nested)) return nested;
  }

  const controlSelector = "input, textarea, select, button, [role='button'], [role='checkbox'], [role='combobox'], [role='textbox']";
  const controls = Array.from(root.querySelectorAll(controlSelector));
  const direct = controls.find((element) => elementAccessibleText(element).toLowerCase().includes(needle) && isElementVisible(element));
  if (direct) return direct;

  const rows = Array.from(root.querySelectorAll(".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']"));
  const row = rows.find((candidate) => isElementVisible(candidate) && elementAccessibleText(candidate).toLowerCase().includes(needle));
  return row ? pickElement(Array.from(row.querySelectorAll(controlSelector))) : undefined;
}

export function findByRole(role: string, name?: string, root: ParentNode = document, nth?: number, exact?: boolean): Element | undefined {
  return pickElement(findAllByRole(role, name, root, exact), nth);
}

export function findAllByRole(role: string, name?: string, root: ParentNode = document, exact?: boolean): Element[] {
  const selectors = role === "button"
    ? "button, [role='button'], input[type='button'], input[type='submit']"
    : role === "textbox"
      ? "input, textarea, [role='textbox']"
      : role === "checkbox"
        ? CHECKBOX_TARGET_SELECTOR
        : role === "combobox"
          ? "select, [role='combobox'], input[role='combobox'], [aria-haspopup='listbox']"
          : role === "option"
            ? "option, [role='option'], li[class*='option'], [class*='select-option'], [class*='virtual-filter-select-option']"
            : `[role='${role}']`;
  return actionableElements(Array.from(root.querySelectorAll(selectors))).filter((element) => {
    if (!name) return true;
    const accessible = elementAccessibleText(element).toLowerCase();
    const needle = normalizeReplayText(name).toLowerCase();
    return exact ? accessible === needle : accessible.includes(needle);
  });
}

export function pickElement(elements: Element[], nth?: number): Element | undefined {
  const actionable = actionableElements(elements);
  if (actionable.length === 0) return undefined;
  if (actionable.length === 1) return actionable[0];
  return nth === undefined ? actionable[0] : actionable[nth];
}

export function actionableElements(elements: Element[]): Element[] {
  return elements
    .map((element) => isCheckboxLike(element) ? bestCheckboxTarget(element) : element)
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(isElementVisible);
}

export function isCheckboxLike(element: Element): boolean {
  return element.matches(CHECKBOX_TARGET_SELECTOR) || Boolean(element.closest(CHECKBOX_TARGET_SELECTOR));
}

export function bestCheckboxTarget(element: Element): Element {
  const label = element.closest("label");
  if (label && isElementVisible(label)) return label;
  const visibleWrapper = element.closest('[role="checkbox"], [class*="checkbox"], [class*="Checkbox"], [class*="cpzui-checkbox"], [class*="zm-checkbox"], [class*="zmu-checkbox"]');
  if (visibleWrapper && isElementVisible(visibleWrapper)) return visibleWrapper;
  return element;
}

export function associatedCheckboxLabel(element: Element): string | undefined {
  const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null);
  return label?.textContent?.replace(/\s+/g, " ").trim();
}

export function elementAccessibleText(element: Element): string {
  const doc = element.ownerDocument ?? document;
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledByText = labelledBy
    ?.split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(" ");
  return normalizeReplayText([
    labelledByText,
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : undefined,
    visibleText(element),
    associatedCheckboxLabel(element)
  ].filter(Boolean).join(" "));
}

export async function findByText(text: string, timeout: number): Promise<Element> {
  let found: Element | undefined;
  await waitFor(() => {
    found = Array.from(document.querySelectorAll("body *")).find((element) => {
      if (!isElementVisible(element)) return false;
      return visibleText(element).toLowerCase().includes(text.toLowerCase());
    });
    return Boolean(found);
  }, timeout, `Expected visible text "${text}"`);
  return found!;
}

export function setElementValue(element: Element, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Target element is not fillable");
  }
  element.focus();
  element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function replayClickElement(element: Element): void {
  const target = element instanceof HTMLElement ? element : element.closest<HTMLElement>("button, a, input, textarea, select, [role], li, [class*='option'], [class*='select']") ?? undefined;
  if (!target) return;
  target.scrollIntoView?.({ block: "center", inline: "center" });
  target.focus?.();
  const rect = target.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1
  };

  dispatchPointerMouseEvent(target, "pointerover", eventInit);
  dispatchPointerMouseEvent(target, "mouseover", eventInit);
  dispatchPointerMouseEvent(target, "pointermove", eventInit);
  dispatchPointerMouseEvent(target, "mousemove", eventInit);
  dispatchPointerMouseEvent(target, "pointerdown", eventInit);
  dispatchPointerMouseEvent(target, "mousedown", eventInit);
  dispatchPointerMouseEvent(target, "pointerup", { ...eventInit, buttons: 0 });
  dispatchPointerMouseEvent(target, "mouseup", { ...eventInit, buttons: 0 });
  dispatchPointerMouseEvent(target, "click", { ...eventInit, buttons: 0 });
}

function dispatchPointerMouseEvent(target: HTMLElement, type: string, init: MouseEventInit): void {
  const EventCtor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  target.dispatchEvent(new EventCtor(type, init));
}

export function isInputElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.getAttribute("contenteditable") === "true";
}

export function inputElementValue(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return el.textContent ?? "";
}

export function isSameOrChildOf(target: Element, reference: Element): boolean {
  return target === reference || reference.contains(target) || target.contains(reference);
}

export function isInsideDropdownList(element: Element): boolean {
  return Boolean(element.closest(
    '[class*="select-option"], [class*="dropdown-item"], [class*="option__content"], ' +
    '[role="option"], [role="listbox"], [class*="select__list"], [class*="popper"]'
  ));
}

export function closestZoomComboboxTrigger(element: Element): Element | null {
  if (isInsideDropdownList(element)) return null;

  const candidate = element.closest(
    '[role="combobox"], [class*="cpzui-virtual-filter-select"], [class*="cpzui-select"]'
  );
  if (!candidate || isDropdownContainer(candidate)) return null;

  return candidate;
}

export function isDropdownContainer(element: Element): boolean {
  const className = element.getAttribute("class") ?? "";
  return element.getAttribute("role") === "listbox" ||
    /\bcpzui-select-option\b|\bcpzui-virtual-filter-select-option\b|select-option|select-dropdown|popper/i.test(className);
}

export function normalizedOptionElement(element: Element): Element {
  return element.closest('[role="option"], [class*="cpzui-select-option"], [class*="cpzui-virtual-filter-select-option"], [class*="select-option"]') ?? element;
}

export function getOptionText(element: Element): string | undefined {
  return normalizeZoomOptionText(element);
}

export function isRecorderUI(el: Element): boolean {
  return Boolean(el.closest("#__zoom_recorder_indicator, #__zoom_recorder_picker_instruction, #__zoom_recorder_picker_highlight"));
}

export function isDownloadTrigger(target: Element, text: string | undefined): boolean {
  const anchor = target.closest("a");
  if (anchor) {
    if (anchor.hasAttribute("download")) return true;
    const href = anchor.getAttribute("href") ?? "";
    if (/\.(csv|pdf|xlsx?|zip|json|txt|docx?)(\?|$)/i.test(href)) return true;
  }
  return /\b(download|export)\b/i.test(text ?? "");
}

export function generateId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function detectImpersonationContext(): boolean {
  const url = window.location.href;
  if (url.includes("/submanage") || url.includes("/sub/")) return true;

  const bodyText = document.body?.innerText ?? "";
  if (bodyText.includes("Not a master account")) return true;

  const subAccountBadge = document.querySelector('[class*="sub-account"], [class*="subaccount"]');
  return Boolean(subAccountBadge);
}

export function isLoginOrImpersonationUrl(url: string): boolean {
  return /\/(signin|login|account\/sub\/[^/]+\/login|oauth)/.test(url);
}
