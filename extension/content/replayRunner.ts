import { buildSelectorCandidatesForElement } from "../shared/selectorCandidates.js";
import { optionTextMatches, selectedOptionValueMatches } from "../shared/replayOptionMatching.js";
import type { RecordedAction, ReplayTargetResult, SelectorStrategy, SelectorTestResult } from "../shared/types.js";
import type { RankedSelectorCandidate, SelectorCandidate } from "@zoom-automation/workflow-core";
import {
  CHECKBOX_TARGET_SELECTOR,
  bestCheckboxTarget,
  cssEscape,
  elementAccessibleText,
  elementPreview,
  findByLabel,
  findByRole,
  findByText,
  isElementVisible,
  isInsideDropdownList,
  normalizeReplayText,
  pickElement,
  replayClickElement,
  setElementValue,
  sleep,
  visibleText,
  waitFor
} from "./domHelpers.js";
import { waitForPageReady } from "./pageReadiness.js";
import { evaluatePreflightCondition } from "./replayConditions.js";

const replayWorkflowState = new Map<string, string[]>();

export async function locateReplayElement(action: RecordedAction): Promise<ReplayTargetResult> {
  try {
    const element = await findReplayElement(action);
    return replayTargetResult(element);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function locateReplayOption(action: RecordedAction, optionText: string): Promise<ReplayTargetResult> {
  try {
    const option = await findReplayOption(action, optionText);
    return replayTargetResult(option);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function verifyReplaySelect(action: RecordedAction, expected?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const element = findReplayElementSync(action) ?? await findReplayElement(action);
    await waitForSelectValue(action, element, expected ?? action.selectMetadata?.verificationText ?? action.selectMetadata?.optionLabel ?? resolveReplayValue(action));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeTestAction(action: RecordedAction): Promise<{ ok: boolean; error?: string; skipped?: boolean; message?: string }> {
  try {
    await waitForPageReady(action.timeout ?? 10_000);
    const condition = await evaluatePreflightCondition(action, findReplayElementSync);
    if (condition.skip) {
      return { ok: true, skipped: true, message: condition.message };
    }

    switch (action.type) {
      case "click": {
        const element = await findReplayElement(action);
        replayClickElement(element);
        return { ok: true };
      }
      case "fill": {
        const element = await findReplayElement(action);
        setElementValue(element, resolveReplayValue(action));
        return { ok: true };
      }
      case "select": {
        const wanted = resolveReplayValue(action).trim();
        if (!wanted) {
          return { ok: false, error: "Select step has no value to choose." };
        }
        const element = await findReplayElement(action);
        if (element instanceof HTMLSelectElement) {
          const options = Array.from(element.options);
          const option =
            options.find((c) => c.text.trim() === wanted || c.value === wanted) ??
            options.find((c) => c.text.includes(wanted));
          if (!option) {
            return { ok: false, error: `No option matching "${wanted}"` };
          }
          element.value = option.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }
        replayClickElement(element);
        const option = await findReplayOption(action, action.selectMetadata?.optionLabel ?? wanted);
        replayClickElement(option);
        await waitForSelectValue(action, element, action.selectMetadata?.verificationText ?? action.selectMetadata?.optionLabel ?? wanted);
        return { ok: true };
      }
      case "selectRows": {
        const selected = await selectReplayRows(action);
        return { ok: true, message: `Selected ${selected.length} row(s): ${selected.join(", ")}` };
      }
      case "hover": {
        const element = await findReplayElement(action);
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        return { ok: true };
      }
      case "press": {
        const targetEl = (findReplayElementSync(action) ?? document.activeElement ?? document.body) as Element;
        (targetEl as HTMLElement).focus?.();
        targetEl.dispatchEvent(new KeyboardEvent("keydown", { key: action.key ?? "Enter", bubbles: true }));
        targetEl.dispatchEvent(new KeyboardEvent("keyup", { key: action.key ?? "Enter", bubbles: true }));
        return { ok: true };
      }
      case "wait":
        await sleep(Math.min(Math.max(action.waitMs ?? 1_000, 250), 60_000));
        return { ok: true };
      case "assert":
        await executeAssertion(action);
        return { ok: true };
      case "dismiss":
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: true };
      case "upload":
        return { ok: false, error: "Upload steps cannot be replayed inside the extension preflight runner." };
      case "download":
        return { ok: true, skipped: true, message: "Download steps are verified by the backend Playwright runner, not the preflight." };
      case "dialog":
        return { ok: true, skipped: true, message: "Native dialog handling is verified by the backend Playwright runner." };
      case "if":
        return { ok: true, skipped: true, message: "IF blocks are evaluated by the backend Playwright runner, not the preflight." };
      case "navigate":
      case "screenshot":
        return { ok: true };
      default:
        return { ok: false, error: `Unsupported test action: ${action.type}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await waitForPageReady(action.timeout ?? 10_000, { afterAction: true }).catch(() => undefined);
  }
}

export function findReplayElementSync(action: RecordedAction): Element | undefined {
  const selectors = action.selectors;

  const anchorRoot = resolveAnchorRoot(selectors);
  if (anchorRoot) {
    if (selectors.testId) {
      const el = pickElement(Array.from(anchorRoot.querySelectorAll(`[data-testid="${cssEscape(selectors.testId)}"]`)));
      if (el) return el;
    }
    if (selectors.css) {
      const el = pickElement(Array.from(anchorRoot.querySelectorAll(selectors.css)));
      if (el) return el;
    }
    if (selectors.role) {
      const el = findByRole(selectors.role.role, selectors.role.name, anchorRoot);
      if (el) return el;
    }
    if (selectors.text) {
      const el = pickElement(Array.from(anchorRoot.querySelectorAll("*")).filter(
        (e) => isElementVisible(e) && visibleText(e).toLowerCase().includes(selectors.text!.toLowerCase())
      ));
      if (el) return el;
    }
  }

  if (selectors.testId) {
    const element = pickElement(Array.from(document.querySelectorAll(`[data-testid="${cssEscape(selectors.testId)}"]`)), selectors.nth);
    if (element) return element;
  }
  if (selectors.label) {
    const element = findByLabel(selectors.label);
    if (element) return element;
  }
  if (selectors.role?.name) {
    const element = findByRole(selectors.role.role, selectors.role.name, document, selectors.nth, selectors.role.exact);
    if (element) return element;
  }
  if (selectors.css) {
    const element = pickElement(Array.from(document.querySelectorAll(selectors.css)), selectors.nth);
    if (element) return element;
  }
  if (selectors.role) {
    const element = findByRole(selectors.role.role, selectors.role.name, document, selectors.nth, selectors.role.exact);
    if (element) return element;
  }
  if (selectors.text) {
    return pickElement(
      Array.from(document.querySelectorAll("body *")).filter((element) => isElementVisible(element) && visibleText(element).toLowerCase().includes(selectors.text!.toLowerCase())),
      selectors.nth
    );
  }
  return undefined;
}

export function buildCandidatesFromLegacyAction(action: RecordedAction): SelectorCandidate[] {
  const syntheticTarget = findReplayElementSync(action);
  return syntheticTarget
    ? buildSelectorCandidatesForElement(syntheticTarget)
    : [{
        id: "legacy-selector",
        kind: action.selectors.role ? "role" : action.selectors.label ? "label" : action.selectors.testId ? "testId" : action.selectors.text ? "text" : action.selectors.css ? "css" : "relative",
        selector: action.selectors,
        source: "legacy",
        label: formatCandidateSelector(action.selectors)
      }];
}

export function stripRuntimeScores(candidates: RankedSelectorCandidate[]): SelectorCandidate[] {
  return candidates.map(({ rank: _rank, score: _score, ...candidate }) => candidate);
}

export function candidateResult(candidate: RankedSelectorCandidate): SelectorTestResult["fallbackCandidates"][number] {
  return {
    selector: candidate.selector,
    label: candidateLabel(candidate),
    matchedCount: candidate.diagnostics?.matchedCount ?? 0,
    visibleCount: candidate.diagnostics?.visibleCount ?? 0,
    candidateId: candidate.id,
    kind: candidate.kind,
    score: candidate.score.score,
    scoreLevel: candidate.score.level
  };
}

export function candidateLabel(candidate: RankedSelectorCandidate): string {
  return candidate.label ?? `${candidate.kind}: ${formatCandidateSelector(candidate.selector)}`;
}

export function formatCandidateSelector(selectors: SelectorStrategy): string {
  return [
    selectors.role ? `role=${selectors.role.role}${selectors.role.name ? `/${selectors.role.name}` : ""}` : undefined,
    selectors.label ? `label=${selectors.label}` : undefined,
    selectors.testId ? `testId=${selectors.testId}` : undefined,
    selectors.text ? `text=${selectors.text}` : undefined,
    selectors.css ? `css=${selectors.css}` : undefined,
    selectors.xpath ? `xpath=${selectors.xpath}` : undefined
  ].filter(Boolean).join(" | ") || "selector";
}

function replayTargetResult(element: Element): ReplayTargetResult {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  return {
    ok: true,
    preview: elementPreview(element),
    text: elementAccessibleText(element),
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    }
  };
}

function resolveReplayValue(action: RecordedAction): string {
  const value = action.value ?? "";
  if (!value.includes("{{") || !action.parameterHints?.length) return value;

  return value.replace(/\{\{([^}]+)\}\}/g, (placeholder, rawName) => {
    const paramName = String(rawName).trim();
    const hint = action.parameterHints?.find(
      (candidate) => candidate.confirmed !== false && candidate.suggestedName === paramName
    );
    return hint?.originalValue ?? placeholder;
  });
}

function resolveReplayExpected(value: string): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (placeholder, rawName) => {
    const name = String(rawName).trim();
    const values = replayWorkflowState.get(name);
    return values ? values.join("|") : placeholder;
  });
}

async function selectReplayRows(action: RecordedAction): Promise<string[]> {
  const policy = action.rowSelection;
  if (!policy || policy.mode !== "firstAvailable") {
    throw new Error("Select rows step requires rowSelection.mode=firstAvailable");
  }
  const count = Math.max(1, Number(policy.count ?? 1));
  const minimumCount = Math.max(1, Number(policy.minimumCount ?? count));
  const rowSelector = policy.rowSelector ?? "tr, [role='row']";
  const checkboxSelector = policy.checkboxSelector ?? CHECKBOX_TARGET_SELECTOR;
  const valuePattern = new RegExp(policy.valuePattern ?? "\\+\\d[\\d\\s().-]{5,}");
  const unavailablePattern = policy.unavailableText ? new RegExp(policy.unavailableText, "i") : undefined;
  const timeout = action.timeout ?? 10_000;
  const selectedValues: string[] = [];
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline && selectedValues.length < count) {
    const rows = Array.from(document.querySelectorAll(rowSelector));
    for (const row of rows) {
      if (selectedValues.length >= count) break;
      if (!isElementVisible(row)) continue;
      const rowText = visibleText(row);
      if (unavailablePattern?.test(rowText)) continue;
      const value = rowText.match(valuePattern)?.[0]?.replace(/\s+/g, " ").trim();
      if (!value || selectedValues.includes(value)) continue;
      const checkbox = findReplayRowCheckbox(row, checkboxSelector);
      if (!checkbox || !isElementVisible(checkbox)) continue;
      if (isReplayCheckboxDisabled(checkbox)) continue;
      if (!isReplayCheckboxChecked(checkbox)) {
        await ensureReplayCheckboxChecked(checkbox);
      }
      if (!isReplayCheckboxChecked(checkbox)) continue;
      selectedValues.push(value);
    }
    if (selectedValues.length < count) await sleep(250);
  }

  if (selectedValues.length < minimumCount) {
    throw new Error(`Expected at least ${minimumCount} available row(s), found ${selectedValues.length}`);
  }
  replayWorkflowState.set(policy.outputName ?? "selected.rows", selectedValues);
  return selectedValues;
}

function findReplayRowCheckbox(row: Element, checkboxSelector: string): Element | undefined {
  const candidates = Array.from(row.querySelectorAll(checkboxSelector)).filter(isElementVisible);
  return candidates.find((candidate): candidate is HTMLInputElement =>
    candidate instanceof HTMLInputElement && candidate.type === "checkbox"
  )
    ?? candidates.find((candidate) => candidate.getAttribute("role") === "checkbox")
    ?? pickElement(candidates);
}

async function ensureReplayCheckboxChecked(element: Element): Promise<void> {
  const targets = replayCheckboxClickTargets(element);
  for (const target of targets) {
    if (isReplayCheckboxChecked(element)) return;
    replayClickElement(target);
    await sleep(150);
    if (isReplayCheckboxChecked(element)) return;
  }
}

function replayCheckboxClickTargets(element: Element): Element[] {
  const targets = [
    element,
    bestCheckboxTarget(element),
    element.closest(".cpzui-checkbox__wrap, [class*='checkbox__wrap'], [class*='Checkbox__wrap']"),
    element.closest(".cpzui-checkbox, [class*='checkbox'], [class*='Checkbox']")
  ].filter((candidate): candidate is Element => Boolean(candidate && isElementVisible(candidate)));
  return targets.filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function isReplayCheckboxDisabled(element: Element): boolean {
  if (element instanceof HTMLInputElement) return element.disabled;
  const input = element.querySelector<HTMLInputElement>("input[type='checkbox']");
  if (input) return input.disabled;
  const attr = element.getAttribute("aria-disabled") ?? element.getAttribute("disabled");
  return attr === "" || attr === "true";
}

function isReplayCheckboxChecked(element: Element): boolean {
  if (element instanceof HTMLInputElement) return element.checked;
  const input = element.querySelector<HTMLInputElement>("input[type='checkbox']");
  return Boolean(input?.checked) ||
    element.getAttribute("aria-checked") === "true" ||
    Boolean(element.closest("[aria-checked='true'], .is-checked, [class*='is-checked']"));
}

function hasUsableSelector(selectors: SelectorStrategy): boolean {
  return Boolean(selectors.role || selectors.label || selectors.text || selectors.testId || selectors.css);
}

async function executeAssertion(action: RecordedAction): Promise<void> {
  const expected = resolveReplayExpected(action.expected ?? action.value ?? "");
  const timeout = action.timeout ?? 10_000;
  switch (action.assertionType) {
    case "urlContains":
      if (!window.location.href.includes(expected)) {
        throw new Error(`Expected URL to contain "${expected}"`);
      }
      return;
    case "urlMatches":
      if (!new RegExp(expected).test(window.location.href)) {
        throw new Error(`Expected URL to match "${expected}"`);
      }
      return;
    case "elementVisible":
      await waitFor(() => {
        const element = hasUsableSelector(action.selectors)
          ? findReplayElementSync(action)
          : document.querySelector(expected);
        return Boolean(element && isElementVisible(element));
      }, timeout, `Expected selector to be visible: ${expected}`);
      return;
    case "fieldValue":
    case "hasValue":
      await waitFor(() => {
        if (hasUsableSelector(action.selectors)) {
          const element = findReplayElementSync(action);
          return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value === expected
            : false;
        }
        const fields = Array.from(document.querySelectorAll("input, textarea")) as Array<HTMLInputElement | HTMLTextAreaElement>;
        return fields.some((field) => field.value === expected);
      }, timeout, `Expected a field value to equal "${expected}"`);
      return;
    case "tableRowContains":
      await waitFor(() => Array.from(document.querySelectorAll("tr, [role='row']")).some((row) => visibleText(row).includes(expected)), timeout, `Expected table row containing "${expected}"`);
      return;
    case "addressStatusEquals":
      await waitFor(() => Array.from(document.querySelectorAll("tr, [role='row']")).some((row) => visibleText(row).includes(expected)), timeout, `Expected address status "${expected}"`);
      return;
    case "entityExists":
    case "entityState":
      await waitFor(() => expected.split("|").every((token) => visibleText(document.body).toLowerCase().includes(token.trim().toLowerCase())), timeout, `Expected entity "${expected}"`);
      return;
    case "entityAbsent":
      await waitFor(() => expected.split("|").every((token) => !visibleText(document.body).toLowerCase().includes(token.trim().toLowerCase())), timeout, `Expected entity "${expected}" to be absent`);
      return;
    case "toastVisible":
      await waitFor(() => Array.from(document.querySelectorAll("[role='status'], [role='alert'], .toast, .zm-toast, .zmu-toast, [class*='toast'], [class*='Toast'], [class*='banner']")).some((toast) => isElementVisible(toast) && visibleText(toast).includes(expected)), timeout, `Expected toast or banner containing "${expected}"`);
      return;
    case "textVisible":
    case "hasText":
    default:
      await findByText(expected, timeout);
      return;
  }
}

async function findReplayElement(action: RecordedAction): Promise<Element> {
  const timeout = action.timeout ?? 10_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeout) {
    const syncElement = findReplayElementSync(action);
    if (syncElement) return syncElement;
    await sleep(150);
  }
  if (action.selectors.text) {
    return await findByText(action.selectors.text, Math.min(timeout, 5_000));
  }
  throw new Error(`Could not find element for ${action.description ?? action.type}`);
}

async function findReplayOption(action: RecordedAction, optionText: string): Promise<Element> {
  const timeout = action.timeout ?? 10_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeout) {
    const popupOption = findOpenPopupOption(optionText);
    if (popupOption) return popupOption;

    for (const candidate of action.selectMetadata?.optionCandidates ?? []) {
      const option = findReplayElementSync({ ...action, type: "click", selectors: candidate.selector });
      if (option && isInsideOpenSelectPopup(option) && optionTextMatches(optionText, elementAccessibleText(option))) return option;
    }
    await sleep(150);
  }
  throw new Error(`Could not find open select option "${optionText}"`);
}

async function waitForSelectValue(action: RecordedAction, element: Element, expected: string): Promise<void> {
  const timeout = Math.min(Math.max(action.timeout ?? 10_000, 1_500), 5_000);
  const anchorRoot = resolveAnchorRoot(action.selectors);
  const needle = normalizeReplayText(expected).toLowerCase();
  let observedTexts: string[] = [];

  await waitFor(() => {
    observedTexts = collectSelectVerificationTexts(action, element, anchorRoot);
    return observedTexts.some((text) =>
      selectedOptionValueMatches(expected, text) ||
      text.toLowerCase().includes(needle)
    );
  }, timeout, () => `Select step did not apply "${expected}". Observed: ${observedTexts.slice(0, 6).join(" | ") || "none"}`);
}

function collectSelectVerificationTexts(action: RecordedAction, element: Element, anchorRoot?: Element): string[] {
  const candidates: Element[] = [];
  const add = (candidate: Element | null | undefined) => {
    if (!candidate || candidates.includes(candidate)) return;
    if (candidate === document.body || candidate === document.documentElement) return;
    candidates.push(candidate);
  };

  const addElementContext = (candidate: Element | null | undefined) => {
    if (!candidate) return;
    add(candidate);
    add(candidate.closest(".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']"));
    add(candidate.closest("[role='combobox'], [aria-haspopup='listbox'], [class*='select-input'], [class*='filter-select']"));
  };

  addElementContext(element);
  addElementContext(findReplayElementSync(action));
  if (anchorRoot) {
    add(anchorRoot);
    anchorRoot.querySelectorAll("input, textarea, select, [role='combobox'], [role='textbox'], [aria-haspopup='listbox']").forEach(addElementContext);
  }

  const active = document.activeElement;
  const expectedLabel = action.selectors.label ?? action.selectors.role?.name ?? action.selectors.anchor?.text;
  if (active instanceof Element) {
    const activeText = elementAccessibleText(active).toLowerCase();
    const activeLooksRelated = anchorRoot?.contains(active) ||
      Boolean(expectedLabel && activeText.includes(expectedLabel.toLowerCase()));
    if (activeLooksRelated) addElementContext(active);
  }

  return candidates
    .flatMap((candidate) => explicitElementTexts(candidate))
    .map(normalizeReplayText)
    .filter(Boolean)
    .filter((text, index, all) => all.indexOf(text) === index);
}

function explicitElementTexts(element: Element): string[] {
  const values = [
    elementAccessibleText(element),
    visibleText(element)
  ];
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    values.unshift(element.value);
  }
  return values;
}

function findOpenPopupOption(optionText: string): Element | undefined {
  const needle = normalizeReplayText(optionText).toLowerCase();
  const popups = Array.from(document.querySelectorAll([
    "[role='listbox']",
    ".cpzui-select__list",
    ".cpzui-select-dropdown",
    ".cpzui-virtual-filter-select-dropdown",
    "[class*='select-dropdown']",
    "[class*='select__list']"
  ].join(","))).filter(isElementVisible);

  const optionSelector = [
    "[role='option']",
    "option",
    "li",
    "[class*='option']",
    "[data-testid*='Option']",
    "[data-test-id*='Option']"
  ].join(",");

  for (const popup of popups) {
    const options = Array.from(popup.querySelectorAll(optionSelector)).filter(isElementVisible);
    const exact = options.find((option) => normalizeReplayText(elementAccessibleText(option)).toLowerCase() === needle);
    if (exact) return bestClickableOption(exact);

    const contains = options.find((option) => optionTextMatches(optionText, elementAccessibleText(option)));
    if (contains) return bestClickableOption(contains);
  }

  return undefined;
}

function bestClickableOption(element: Element): Element {
  return element.closest("[role='option'], li, [class*='option']") ?? element;
}

function isInsideOpenSelectPopup(element: Element): boolean {
  const popup = element.closest([
    "[role='listbox']",
    ".cpzui-select__list",
    ".cpzui-select-dropdown",
    ".cpzui-virtual-filter-select-dropdown",
    "[class*='select-dropdown']",
    "[class*='select__list']"
  ].join(","));
  return Boolean(popup && isElementVisible(popup));
}

function resolveAnchorRoot(selectors: SelectorStrategy): Element | undefined {
  const anchor = selectors.anchor;
  if (!anchor?.text) return undefined;
  const scopeSelector = anchor.scopeSelector
    ?? (anchor.scopeRole === "dialog" ? "[role='dialog'], dialog"
      : anchor.scopeRole === "listitem" ? "li, [role='listitem']"
      : "tr, [role='row']");
  return Array.from(document.querySelectorAll(scopeSelector)).find(
    (container) => isElementVisible(container) && elementAccessibleText(container).toLowerCase().includes(anchor.text!.toLowerCase())
  );
}
