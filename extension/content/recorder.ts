/**
 * Content script that captures user interactions in the Zoom admin portal.
 * Runs on all zoom.us pages. Only actively records when told to by the
 * background service worker.
 */
import { extractSelectors, getFieldContext } from "../shared/selectors.js";
import { detectParameters } from "../shared/parameterizer.js";
import type { RecordedAction, ExtensionMessage, ActionType, SelectorStrategy, SelectorTestResult } from "../shared/types.js";

let recording = false;
let paused = false;
let actionQueue: RecordedAction[] = [];
let lastFillTimeout: ReturnType<typeof setTimeout> | undefined;
let lastFillElement: Element | null = null;
let lastFillValue = "";
let impersonationDetected = false;

// Click deduplication state
let lastClickTarget: Element | null = null;
let lastClickTime = 0;
const CLICK_DEDUP_THRESHOLD_MS = 500;

// Combobox interaction tracking
let activeCombobox: { element: Element; label: string | undefined; openedAt: number } | null = null;

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    startRecording();
    sendResponse({ ok: true });
  } else if (message.type === "STOP_RECORDING") {
    stopRecording();
    sendResponse({ ok: true });
  } else if (message.type === "PAUSE_RECORDING") {
    paused = true;
    flushPendingFill();
    showRecordingIndicator();
    sendResponse({ ok: true });
  } else if (message.type === "RESUME_RECORDING") {
    paused = false;
    showRecordingIndicator();
    sendResponse({ ok: true });
  } else if (message.type === "GET_STATUS") {
    sendResponse({ recording, paused, actionCount: actionQueue.length });
  } else if (message.type === "EXECUTE_TEST_ACTION") {
    void executeTestAction(message.action).then(sendResponse);
  } else if (message.type === "TEST_SELECTOR") {
    void testSelector(message.action).then(sendResponse);
  }
  return true;
});

// ─── Recording Control ───────────────────────────────────────────────────────

function startRecording(): void {
  recording = true;
  paused = false;
  actionQueue = [];
  impersonationDetected = detectImpersonationContext();
  attachListeners();
  showRecordingIndicator();
  
  // Record initial navigation (skip if it's a login/impersonation page)
  if (!isLoginOrImpersonationUrl(window.location.href)) {
    recordAction({
      type: "navigate",
      url: window.location.href,
      selectors: {},
      description: `Navigate to ${document.title}`
    });
  }

  // Notify background about impersonation context
  chrome.runtime.sendMessage({
    type: "ACTION_RECORDED",
    action: {
      id: `meta_${Date.now().toString(36)}`,
      timestamp: Date.now(),
      type: "navigate",
      selectors: {},
      pageUrl: window.location.href,
      pageTitle: document.title,
      description: impersonationDetected
        ? "Recording started in sub-account context (impersonation handled automatically)"
        : "Recording started in master account context"
    }
  } satisfies ExtensionMessage);
}

function stopRecording(): void {
  recording = false;
  paused = false;
  flushPendingFill();
  detachListeners();
  hideRecordingIndicator();
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function attachListeners(): void {
  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  document.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("hashchange", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
}

function detachListeners(): void {
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("change", handleChange, true);
  document.removeEventListener("keydown", handleKeydown, true);
  window.removeEventListener("hashchange", handleNavigation);
  window.removeEventListener("popstate", handleNavigation);
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function handleClick(event: MouseEvent): void {
  if (!recording || paused) return;
  const target = event.target as Element;
  if (!target || isRecorderUI(target)) return;

  // ─── Click Deduplication ─────────────────────────────────────────────
  // Suppress rapid repeated clicks on the same element (user clicking
  // multiple times because UI is slow to respond)
  const now = Date.now();
  if (lastClickTarget && isSameOrChildOf(target, lastClickTarget) && (now - lastClickTime) < CLICK_DEDUP_THRESHOLD_MS) {
    return; // Duplicate click — skip
  }
  lastClickTarget = target;
  lastClickTime = now;

  flushPendingFill();

  // Skip clicks on input fields (they'll be captured as fill actions)
  if (isInputElement(target)) return;

  const selectors = extractSelectors(target);
  const text = selectors.text ?? selectors.role?.name ?? target.textContent?.trim().slice(0, 60);

  // ─── File Upload Detection ───────────────────────────────────────────
  const fileInput = target.closest("label")?.querySelector('input[type="file"]') ??
                    target.querySelector('input[type="file"]');
  if (fileInput) {
    recordAction({
      type: "upload",
      selectors,
      description: `Upload file via "${text ?? "file input"}"`
    });
    return;
  }

  // ─── Combobox/Dropdown Detection ─────────────────────────────────────
  // If clicking opens a Zoom combobox dropdown, track it so the next click
  // (selecting an option) gets recorded as a "select" action instead of "click"
  const comboboxWrapper = target.closest(
    '[class*="cpzui-select"]:not([class*="option"]), ' +
    '[class*="cpzui-virtual-filter-select"]:not([class*="option"]), ' +
    '[role="combobox"]'
  );
  if (comboboxWrapper && !isInsideDropdownList(target)) {
    activeCombobox = {
      element: comboboxWrapper,
      label: selectors.label ?? selectors.role?.name,
      openedAt: now
    };
    // Don't record the "open combobox" click — we'll record the selection instead
    return;
  }

  // ─── Option Selection Detection ──────────────────────────────────────
  // If we have an active combobox and the user clicks an option, record as "select"
  if (activeCombobox && isInsideDropdownList(target)) {
    const optionText = getOptionText(target);
    if (optionText) {
      const fieldCtx = getFieldContext(activeCombobox.element);
      const params = detectParameters(optionText, fieldCtx);

      recordAction({
        type: "select",
        selectors: {
          role: { role: "combobox", name: activeCombobox.label },
          label: activeCombobox.label,
          text: optionText
        },
        value: optionText,
        parameterHints: params.length > 0 ? params : undefined,
        description: `Select "${optionText}" in ${activeCombobox.label ?? "dropdown"}`
      });
      activeCombobox = null;
      return;
    }
  }

  // ─── Checkbox Detection ──────────────────────────────────────────────
  const checkbox = target.closest('[class*="cpzui-checkbox"], [role="checkbox"], input[type="checkbox"]');
  if (checkbox) {
    recordAction({
      type: "click",
      selectors: {
        role: { role: "checkbox", name: selectors.role?.name },
        ...selectors
      },
      description: `Toggle checkbox "${selectors.role?.name ?? selectors.label ?? ""}"`
    });
    return;
  }

  // ─── Regular Click ───────────────────────────────────────────────────
  // Clear active combobox if clicking elsewhere
  if (activeCombobox && (now - activeCombobox.openedAt) > 5000) {
    activeCombobox = null;
  }

  recordAction({
    type: "click",
    selectors,
    description: `Click "${text ?? "element"}"`
  });
}

function handleInput(event: Event): void {
  if (!recording || paused) return;
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target || !isInputElement(target)) return;
  if (isRecorderUI(target)) return;

  // Debounce rapid typing into a single "fill" action
  if (lastFillElement === target) {
    lastFillValue = target.value;
    clearTimeout(lastFillTimeout);
    lastFillTimeout = setTimeout(() => flushPendingFill(), 800);
  } else {
    flushPendingFill();
    lastFillElement = target;
    lastFillValue = target.value;
    lastFillTimeout = setTimeout(() => flushPendingFill(), 800);
  }
}

function handleChange(event: Event): void {
  if (!recording || paused) return;
  const target = event.target as HTMLSelectElement;
  if (!target || target.tagName.toLowerCase() !== "select") return;
  if (isRecorderUI(target)) return;

  flushPendingFill();

  const selectors = extractSelectors(target);
  const selectedText = target.options[target.selectedIndex]?.text ?? target.value;
  const fieldCtx = getFieldContext(target);
  const params = detectParameters(selectedText, fieldCtx);

  recordAction({
    type: "select",
    selectors,
    value: selectedText,
    parameterHints: params.length > 0 ? params : undefined,
    description: `Select "${selectedText}" in ${selectors.label ?? selectors.role?.name ?? "dropdown"}`
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (!recording || paused) return;
  // Capture Enter key on buttons/links as explicit clicks
  if (event.key === "Enter") {
    const target = event.target as Element;
    if (target && (target.tagName === "BUTTON" || target.getAttribute("role") === "button")) {
      flushPendingFill();
      const selectors = extractSelectors(target);
      recordAction({
        type: "click",
        selectors,
        description: `Press Enter on "${selectors.role?.name ?? target.textContent?.trim()}"`
      });
    }
  }
}

function handleNavigation(): void {
  if (!recording || paused) return;
  
  // Skip login, sign-in, and impersonation navigation — these are handled
  // automatically by the automation engine's impersonateSubAccount() function
  if (isLoginOrImpersonationUrl(window.location.href)) {
    return;
  }

  // Detect if we just entered an impersonated context
  if (!impersonationDetected && detectImpersonationContext()) {
    impersonationDetected = true;
    // Don't record this navigation — the engine handles impersonation
    return;
  }

  flushPendingFill();
  recordAction({
    type: "navigate",
    url: window.location.href,
    selectors: {},
    description: `Navigate to ${window.location.hash || window.location.pathname}`
  });
}

// ─── Fill Debouncing ─────────────────────────────────────────────────────────

function flushPendingFill(): void {
  if (!lastFillElement || !lastFillValue) {
    lastFillElement = null;
    lastFillValue = "";
    return;
  }

  const selectors = extractSelectors(lastFillElement);
  const fieldCtx = getFieldContext(lastFillElement);
  const params = detectParameters(lastFillValue, fieldCtx);

  recordAction({
    type: "fill",
    selectors,
    value: lastFillValue,
    parameterHints: params.length > 0 ? params : undefined,
    description: `Fill "${selectors.label ?? selectors.role?.name ?? "field"}" with "${lastFillValue.slice(0, 30)}${lastFillValue.length > 30 ? "…" : ""}"`
  });

  lastFillElement = null;
  lastFillValue = "";
  clearTimeout(lastFillTimeout);
}

// ─── Action Recording ────────────────────────────────────────────────────────

function recordAction(partial: Partial<RecordedAction> & { type: ActionType; selectors: RecordedAction["selectors"] }): void {
  const action: RecordedAction = {
    id: generateId(),
    timestamp: Date.now(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    ...partial
  };

  actionQueue.push(action);

  // Send to background service worker
  chrome.runtime.sendMessage({
    type: "ACTION_RECORDED",
    action
  } satisfies ExtensionMessage);
}

// ─── Browser Test Replay ─────────────────────────────────────────────────────

async function executeTestAction(action: RecordedAction): Promise<{ ok: boolean; error?: string; skipped?: boolean; message?: string }> {
  try {
    const condition = await evaluatePreflightCondition(action);
    if (condition.skip) {
      return { ok: true, skipped: true, message: condition.message };
    }

    switch (action.type) {
      case "click": {
        const element = await findReplayElement(action);
        (element as HTMLElement).click();
        return { ok: true };
      }
      case "fill": {
        const element = await findReplayElement(action);
        setElementValue(element, action.value ?? "");
        return { ok: true };
      }
      case "select": {
        const element = await findReplayElement(action);
        if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find((candidate) => candidate.text.includes(action.value ?? "") || candidate.value === action.value);
          if (option) element.value = option.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }
        (element as HTMLElement).click();
        const option = await findByText(action.value ?? "", 5_000);
        (option as HTMLElement).click();
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
      case "navigate":
      case "screenshot":
        return { ok: true };
      default:
        return { ok: false, error: `Unsupported test action: ${action.type}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function evaluatePreflightCondition(action: RecordedAction): Promise<{ skip: boolean; message?: string }> {
  const condition = action.condition;
  if (!condition || condition.type === "none") {
    return { skip: false };
  }

  if (condition.type === "textExistsSkip" || condition.type === "addressAlreadyExistsSkipAccount") {
    const expectedText = condition.text ?? action.expected ?? action.value ?? "";
    if (expectedText && visibleText(document.body).toLowerCase().includes(expectedText.toLowerCase())) {
      return {
        skip: true,
        message: condition.type === "addressAlreadyExistsSkipAccount"
          ? "Address already exists; skip account"
          : `Text already exists: ${expectedText}`
      };
    }
  }

  if (condition.type === "elementVisibleClick") {
    const target = findReplayElementSync({ ...action, selectors: condition.selector ?? action.selectors });
    if (!target || !isElementVisible(target)) {
      return { skip: true, message: "Conditional element is not visible" };
    }
  }

  if (condition.type === "fieldEmptyFill" && action.type === "fill") {
    const target = findReplayElementSync({ ...action, selectors: condition.selector ?? action.selectors });
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.value.trim()) {
        return { skip: true, message: "Field already has a value" };
      }
    }
  }

  return { skip: false };
}

async function testSelector(action: RecordedAction): Promise<SelectorTestResult> {
  try {
    const candidates = selectorCandidates(action.selectors);
    const results = candidates.map((candidate) => {
      const elements = resolveCandidate(candidate.selector, candidate.label);
      return {
        selector: candidate.selector,
        label: candidate.label,
        matchedCount: elements.length,
        visibleCount: elements.filter(isElementVisible).length
      };
    });

    const chosen = findReplayElementSync(action);
    if (chosen) {
      highlightElement(chosen);
    }

    return {
      actionId: action.id,
      matchedCount: results[0]?.matchedCount ?? 0,
      visibleCount: results[0]?.visibleCount ?? 0,
      chosenPreview: chosen ? elementPreview(chosen) : undefined,
      chosenSelector: results.find((result) => result.visibleCount > 0)?.label,
      fallbackCandidates: results
    };
  } catch (error) {
    return {
      actionId: action.id,
      matchedCount: 0,
      visibleCount: 0,
      fallbackCandidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function executeAssertion(action: RecordedAction): Promise<void> {
  const expected = action.expected ?? action.value ?? "";
  const timeout = action.timeout ?? 10_000;
  switch (action.assertionType) {
    case "urlContains":
      if (!window.location.href.includes(expected)) {
        throw new Error(`Expected URL to contain "${expected}"`);
      }
      return;
    case "elementVisible":
      await waitFor(() => {
        const element = document.querySelector(expected);
        return Boolean(element && isElementVisible(element));
      }, timeout, `Expected selector to be visible: ${expected}`);
      return;
    case "fieldValue":
      await waitFor(() => {
        const fields = Array.from(document.querySelectorAll("input, textarea")) as Array<HTMLInputElement | HTMLTextAreaElement>;
        return fields.some((field) => field.value.includes(expected));
      }, timeout, `Expected a field value to contain "${expected}"`);
      return;
    case "tableRowContains":
      await waitFor(() => Array.from(document.querySelectorAll("tr")).some((row) => visibleText(row).includes(expected)), timeout, `Expected table row containing "${expected}"`);
      return;
    case "textVisible":
    default:
      await findByText(expected, timeout);
      return;
  }
}

async function findReplayElement(action: RecordedAction): Promise<Element> {
  const syncElement = findReplayElementSync(action);
  if (syncElement) return syncElement;
  if (action.selectors.text) {
    return await findByText(action.selectors.text, action.timeout ?? 5_000);
  }
  throw new Error(`Could not find element for ${action.description ?? action.type}`);
}

function findReplayElementSync(action: RecordedAction): Element | undefined {
  const selectors = action.selectors;
  if (selectors.css) {
    const element = document.querySelector(selectors.css);
    if (element && isElementVisible(element)) return element;
  }
  if (selectors.testId) {
    const element = document.querySelector(`[data-testid="${cssEscape(selectors.testId)}"]`);
    if (element && isElementVisible(element)) return element;
  }
  if (selectors.label) {
    const element = findByLabel(selectors.label);
    if (element) return element;
  }
  if (selectors.role) {
    const element = findByRole(selectors.role.role, selectors.role.name);
    if (element) return element;
  }
  if (selectors.text) {
    return Array.from(document.querySelectorAll("body *")).find((element) => isElementVisible(element) && visibleText(element).toLowerCase().includes(selectors.text!.toLowerCase()));
  }
  return undefined;
}

function selectorCandidates(selectors: SelectorStrategy): Array<{ label: string; selector: SelectorStrategy }> {
  const candidates: Array<{ label: string; selector: SelectorStrategy }> = [];
  if (selectors.role) candidates.push({ label: `Role: ${selectors.role.role}${selectors.role.name ? ` / ${selectors.role.name}` : ""}`, selector: { role: selectors.role } });
  if (selectors.label) candidates.push({ label: `Label: ${selectors.label}`, selector: { label: selectors.label } });
  if (selectors.text) candidates.push({ label: `Text: ${selectors.text}`, selector: { text: selectors.text } });
  if (selectors.testId) candidates.push({ label: `Test ID: ${selectors.testId}`, selector: { testId: selectors.testId } });
  if (selectors.css) candidates.push({ label: `CSS: ${selectors.css}`, selector: { css: selectors.css } });
  return candidates;
}

function resolveCandidate(selector: SelectorStrategy, label: string): Element[] {
  if (selector.css) return Array.from(document.querySelectorAll(selector.css));
  if (selector.testId) return Array.from(document.querySelectorAll(`[data-testid="${cssEscape(selector.testId)}"]`));
  if (selector.label) {
    const target = findByLabel(selector.label);
    return target ? [target] : [];
  }
  if (selector.role) {
    const target = findByRole(selector.role.role, selector.role.name);
    return target ? [target] : [];
  }
  if (selector.text) {
    return Array.from(document.querySelectorAll("body *")).filter((element) => visibleText(element).toLowerCase().includes(selector.text!.toLowerCase()));
  }
  if (label) return [];
  return [];
}

function highlightElement(element: Element): void {
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

function elementPreview(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? visibleText(element);
  return `<${tag}> ${label.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

function findByLabel(labelText: string): Element | undefined {
  const labels = Array.from(document.querySelectorAll("label"));
  for (const label of labels) {
    if (!visibleText(label).toLowerCase().includes(labelText.toLowerCase())) continue;
    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target && isElementVisible(target)) return target;
    }
    const nested = label.querySelector("input, textarea, select, button, [role='button'], [role='checkbox']");
    if (nested && isElementVisible(nested)) return nested;
  }

  const aria = Array.from(document.querySelectorAll("input, textarea, select, button, [aria-label]"));
  return aria.find((element) => (element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? "").toLowerCase().includes(labelText.toLowerCase()) && isElementVisible(element));
}

function findByRole(role: string, name?: string): Element | undefined {
  const selectors = role === "button"
    ? "button, [role='button'], input[type='button'], input[type='submit']"
    : role === "textbox"
      ? "input, textarea, [role='textbox']"
      : role === "checkbox"
        ? "input[type='checkbox'], [role='checkbox'], [class*='checkbox']"
        : `[role='${role}']`;
  const elements = Array.from(document.querySelectorAll(selectors));
  return elements.find((element) => {
    if (!isElementVisible(element)) return false;
    if (!name) return true;
    const accessible = `${visibleText(element)} ${element.getAttribute("aria-label") ?? ""} ${(element as HTMLInputElement).value ?? ""}`.trim();
    return accessible.toLowerCase().includes(name.toLowerCase());
  });
}

async function findByText(text: string, timeout: number): Promise<Element> {
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

function setElementValue(element: Element, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Target element is not fillable");
  }
  element.focus();
  element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(predicate: () => boolean, timeout: number, errorMessage: string): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(errorMessage);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function visibleText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

// ─── Recording Indicator ─────────────────────────────────────────────────────

function showRecordingIndicator(): void {
  const existingLabel = document.querySelector("#__zoom_recorder_indicator [data-recorder-label]");
  if (existingLabel) {
    existingLabel.textContent = paused ? "Recording paused" : "Recording workflow...";
    return;
  }
  const indicator = document.createElement("div");
  indicator.id = "__zoom_recorder_indicator";
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: #e53935;
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      pointer-events: none;
    ">
      <span style="width:8px;height:8px;border-radius:50%;background:white;animation:pulse 1s infinite;"></span>
      <span data-recorder-label>${paused ? "Recording paused" : "Recording workflow..."}</span>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
  `;
  document.body.appendChild(indicator);
}

function hideRecordingIndicator(): void {
  document.getElementById("__zoom_recorder_indicator")?.remove();
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function isInputElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.getAttribute("contenteditable") === "true";
}

/**
 * Check if target is the same element or a child of the reference element.
 * Used for click deduplication — clicking an SVG inside a button counts as
 * the same click as clicking the button itself.
 */
function isSameOrChildOf(target: Element, reference: Element): boolean {
  return target === reference || reference.contains(target) || target.contains(reference);
}

/**
 * Check if an element is inside a dropdown/option list (not the combobox trigger).
 */
function isInsideDropdownList(element: Element): boolean {
  return Boolean(element.closest(
    '[class*="select-option"], [class*="dropdown-item"], [class*="option__content"], ' +
    '[role="option"], [role="listbox"], [class*="select__list"], [class*="popper"]'
  ));
}

/**
 * Extract the visible text of a dropdown option, handling Zoom's nested structure.
 */
function getOptionText(element: Element): string | undefined {
  // Look for the content/tooltip wrapper first
  const optionWrapper = element.closest('[class*="select-option"], [role="option"]');
  if (!optionWrapper) return element.textContent?.trim().slice(0, 80) || undefined;

  // Try specific content elements
  const contentEl = optionWrapper.querySelector(
    '[class*="option__content"], [class*="tooltip__trigger"], [class*="cp-w-full"]'
  );
  const text = (contentEl ?? optionWrapper).textContent?.trim();
  return text && text.length > 0 && text.length < 100 ? text : undefined;
}

function isRecorderUI(el: Element): boolean {
  return Boolean(el.closest("#__zoom_recorder_indicator"));
}

function generateId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect if the current page is within an impersonated sub-account context.
 * Zoom shows "submanage" in the URL or "Not a master account" in the page
 * when impersonating.
 */
function detectImpersonationContext(): boolean {
  const url = window.location.href;
  if (url.includes("/submanage") || url.includes("/sub/")) return true;
  
  // Check for Zoom's impersonation indicator in the page
  const bodyText = document.body?.innerText ?? "";
  if (bodyText.includes("Not a master account")) return true;
  
  // Check for the sub-account switcher UI element
  const subAccountBadge = document.querySelector('[class*="sub-account"], [class*="subaccount"]');
  if (subAccountBadge) return true;
  
  return false;
}

/**
 * Check if a URL is a login, sign-in, or impersonation URL that should
 * be filtered from recordings (the automation engine handles these).
 */
function isLoginOrImpersonationUrl(url: string): boolean {
  return /\/(signin|login|account\/sub\/[^/]+\/login|oauth)/.test(url);
}
