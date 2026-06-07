/**
 * Content script that captures user interactions in the Zoom admin portal.
 * Runs on all zoom.us pages. Only actively records when told to by the
 * background service worker.
 */
import { extractSelectors, getFieldContext, getAriaState, getFrameSelector, computeNth, computeAnchor } from "../shared/selectors.js";
import { buildSelectorCandidatesForElement, testSelectorCandidatesInDocument } from "../shared/selectorCandidates.js";
import { detectParameters } from "../shared/parameterizer.js";
import type { RecordedAction, ExtensionMessage, ActionType, SelectorStrategy, AnchorPickResult, SelectorPickResult, SelectorTestResult } from "../shared/types.js";
import type { RankedSelectorCandidate, SelectorCandidate } from "@zoom-automation/workflow-core";

let recording = false;
let paused = false;
let actionQueue: RecordedAction[] = [];
let lastFillTimeout: ReturnType<typeof setTimeout> | undefined;
let lastFillElement: Element | null = null;
let lastFillValue = "";
let impersonationDetected = false;
let activeSelectorPick: { cancel: (message: string) => void } | undefined;

// Click deduplication state
let lastClickTarget: Element | null = null;
let lastClickTime = 0;
const CLICK_DEDUP_THRESHOLD_MS = 500;

// Combobox interaction tracking
let activeCombobox: { element: Element; label: string | undefined; openedAt: number } | null = null;

// Hover deduplication state (feature 4)
let lastHoverTarget: Element | null = null;
// Hover capture is intentionally off by default: Zoom pages produce many
// incidental mouseovers, which makes recorded workflows noisy and hard to review.
const RECORD_HOVER_STEPS_BY_DEFAULT = false;

// Frame selector for this recorder context — undefined in the top frame (feature 1)
const frameSelector = getFrameSelector();

// Network capture for submit-triggered XHR/fetch waits (feature 2)
const SUBMIT_LABEL_PATTERN = /save|submit|add|continue|next|confirm|apply|create|update/i;
const recentNetworkEntries: Array<{ url: string; startTime: number }> = [];
startNetworkObserver();

const PAGE_READY_QUIET_MS = 450;
const PAGE_READY_INITIAL_SETTLE_MS = 150;
const PAGE_READY_LOADING_SELECTORS = [
  "[aria-busy='true']",
  "[role='progressbar']",
  ".loading",
  ".loader",
  ".spinner",
  ".zm-loader",
  ".zm-loading",
  ".cpzui-loading",
  ".cpzui-spinner",
  "[class*='loading']",
  "[class*='spinner']"
].join(",");

const CHECKBOX_TARGET_SELECTOR = [
  'input[type="checkbox"]',
  '[role="checkbox"]',
  'label:has(input[type="checkbox"])',
  '[class*="checkbox"]',
  '[class*="Checkbox"]',
  '[class*="cpzui-checkbox"]',
  '[class*="zm-checkbox"]',
  '[class*="zmu-checkbox"]'
].join(",");

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
  } else if (message.type === "WAIT_FOR_PAGE_READY") {
    void waitForPageReady(message.timeout ?? 10_000).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  } else if (message.type === "EXECUTE_TEST_ACTION") {
    void executeTestAction(message.action).then(sendResponse);
  } else if (message.type === "TEST_SELECTOR") {
    void testSelector(message.action).then(sendResponse);
  } else if (message.type === "PICK_SELECTOR") {
    void pickSelector(message.action).then(sendResponse);
  } else if (message.type === "PICK_ANCHOR") {
    void pickAnchor(message.action).then(sendResponse);
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
  if (RECORD_HOVER_STEPS_BY_DEFAULT) {
    document.addEventListener("mouseover", handleMouseOver, true);
  }
  window.addEventListener("hashchange", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
}

function detachListeners(): void {
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("change", handleChange, true);
  document.removeEventListener("keydown", handleKeydown, true);
  if (RECORD_HOVER_STEPS_BY_DEFAULT) {
    document.removeEventListener("mouseover", handleMouseOver, true);
  }
  window.removeEventListener("hashchange", handleNavigation);
  window.removeEventListener("popstate", handleNavigation);
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function handleClick(event: MouseEvent): void {
  if (activeSelectorPick) return;
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
    }, target);
    return;
  }

  // ─── Download Detection (feature 7) ──────────────────────────────────
  // Links with a download attribute, hrefs to file types, or export-style
  // buttons trigger a browser download that the compiler captures via
  // page.waitForEvent("download").
  if (isDownloadTrigger(target, text)) {
    recordAction({
      type: "download",
      selectors,
      description: `Download via "${text ?? "download"}"`
    }, target);
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
      }, target);
      activeCombobox = null;
      return;
    }
  }

  // ─── Checkbox Detection ──────────────────────────────────────────────
  const checkbox = target.closest('[class*="cpzui-checkbox"], [role="checkbox"], input[type="checkbox"]');
  if (checkbox) {
    // Feature 5: capture the desired end-state (the state AFTER this toggle) so
    // the compiled flow only clicks when the checkbox isn't already there.
    const currentState = getAriaState(checkbox);
    const desiredChecked = currentState?.checked === undefined ? undefined : !currentState.checked;
    recordAction({
      type: "click",
      selectors: {
        ...selectors,
        // Force the checkbox role last so it isn't overwritten by a wrapper role
        // that extractSelectors may have resolved.
        role: { role: "checkbox", name: selectors.role?.name }
      },
      ariaState: desiredChecked === undefined ? undefined : { checked: desiredChecked },
      description: `Toggle checkbox "${selectors.role?.name ?? selectors.label ?? ""}"${desiredChecked === undefined ? "" : ` ${desiredChecked ? "on" : "off"}`}`
    }, target);
    return;
  }

  // ─── Expandable Toggle (feature 5) ───────────────────────────────────
  // aria-expanded triggers (accordions, menus) — record desired expanded state.
  const expandable = target.closest('[aria-expanded]');
  if (expandable) {
    const currentState = getAriaState(expandable);
    const desiredExpanded = currentState?.expanded === undefined ? undefined : !currentState.expanded;
    if (desiredExpanded !== undefined) {
      recordAction({
        type: "click",
        selectors,
        ariaState: { expanded: desiredExpanded },
        description: `${desiredExpanded ? "Expand" : "Collapse"} "${text ?? "section"}"`
      }, target);
      return;
    }
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
  }, target);
}

function handleInput(event: Event): void {
  if (activeSelectorPick) return;
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
  if (activeSelectorPick) return;
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

// Keys captured as explicit "press" actions (feature 4). Enter on a button is
// still recorded as a click below for fidelity with user intent.
const PRESS_KEYS = new Set(["Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp"]);

function handleKeydown(event: KeyboardEvent): void {
  if (activeSelectorPick) return;
  if (!recording || paused) return;
  const target = event.target as Element;

  // Capture Enter key. On a button/link it's an explicit click; elsewhere (e.g.
  // submitting a search field) record it as a press so the action isn't lost.
  if (event.key === "Enter") {
    if (!target || isRecorderUI(target)) return;
    flushPendingFill();
    const selectors = extractSelectors(target);
    if (target.tagName === "BUTTON" || target.getAttribute("role") === "button") {
      recordAction({
        type: "click",
        selectors,
        description: `Press Enter on "${selectors.role?.name ?? target.textContent?.trim()}"`
      }, target);
    } else {
      recordAction({
        type: "press",
        selectors: isInputElement(target) ? selectors : {},
        key: "Enter",
        description: `Press Enter${selectors.label || selectors.role?.name ? ` in "${selectors.label ?? selectors.role?.name}"` : ""}`
      }, target);
    }
    return;
  }

  // Capture keyboard navigation keys as "press" actions (feature 4).
  if (PRESS_KEYS.has(event.key) && target && !isRecorderUI(target)) {
    flushPendingFill();
    const selectors = isInputElement(target) ? extractSelectors(target) : {};
    recordAction({
      type: "press",
      selectors,
      key: event.key,
      description: `Press ${event.key}${selectors.label || selectors.role?.name ? ` in "${selectors.label ?? selectors.role?.name}"` : ""}`
    }, target);
  }
}

/**
 * Optional hover capture for elements that reveal content on hover (menus,
 * popovers, tooltips). Disabled by default because Zoom surfaces still generate
 * too many incidental hover steps during normal recording.
 */
function handleMouseOver(event: MouseEvent): void {
  if (activeSelectorPick) return;
  if (!recording || paused) return;
  const target = event.target as Element;
  if (!target || isRecorderUI(target)) return;

  const hoverTrigger = target.closest('[aria-haspopup], [role="menuitem"], [class*="dropdown"], [class*="tooltip"], [class*="menu-trigger"], [data-hover]');
  if (!hoverTrigger || hoverTrigger === lastHoverTarget) return;
  lastHoverTarget = hoverTrigger;

  const selectors = extractSelectors(hoverTrigger);
  const text = selectors.role?.name ?? selectors.text ?? hoverTrigger.textContent?.trim().slice(0, 40);
  recordAction({
    type: "hover",
    selectors,
    description: `Hover "${text ?? "element"}"`
  }, hoverTrigger);
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
  lastHoverTarget = null;
  // Feature 10: record the destination so the compiler can assert arrival via waitForURL.
  const destination = window.location.hash || window.location.pathname;
  recordAction({
    type: "navigate",
    url: window.location.href,
    waitForUrl: destination,
    selectors: {},
    description: `Navigate to ${destination}`
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

function recordAction(
  partial: Partial<RecordedAction> & { type: ActionType; selectors: RecordedAction["selectors"] },
  targetElement?: Element
): void {
  // Feature 1: record the iframe context so the compiler can scope to a frameLocator.
  if (frameSelector && !partial.frameSelector) {
    partial.frameSelector = frameSelector;
  }

  // Feature 3: disambiguate with nth when the primary selector matches several elements.
  if (targetElement && partial.selectors && partial.selectors.nth === undefined) {
    const nth = computeNth(targetElement, partial.selectors);
    if (nth !== undefined) {
      partial.selectors = { ...partial.selectors, nth };
    }
  }

  // Anchors: when the target is inside one of several rows, capture a row anchor
  // (e.g. "the row containing michael.chen@…") — a robust alternative to nth.
  if (targetElement && partial.selectors && !partial.selectors.anchor) {
    const anchor = computeAnchor(targetElement);
    if (anchor) {
      partial.selectors = { ...partial.selectors, anchor };
    }
  }

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

  // Feature 2: for submit-like clicks, watch for the XHR/fetch they trigger and
  // patch the action with a network wait so the compiled flow uses waitForResponse
  // instead of a fixed timeout.
  if (action.type === "click" && SUBMIT_LABEL_PATTERN.test(actionLabel(action))) {
    captureNetworkWaitFor(action);
  }
}

function actionLabel(action: RecordedAction): string {
  return action.selectors.role?.name ?? action.selectors.text ?? action.selectors.label ?? action.description ?? "";
}

// ─── Feature 2: Network-aware waits ────────────────────────────────────────────

/**
 * Observe the page's resource timeline for XHR/fetch calls. The recorder shares
 * the page's performance timeline, so this captures the API requests Zoom makes.
 */
function startNetworkObserver(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        if (resource.initiatorType === "xmlhttprequest" || resource.initiatorType === "fetch") {
          recentNetworkEntries.push({ url: resource.name, startTime: resource.startTime });
          if (recentNetworkEntries.length > 50) recentNetworkEntries.shift();
        }
      }
    });
    observer.observe({ type: "resource", buffered: false });
  } catch {
    // resource timing unavailable — feature degrades gracefully
  }
}

/**
 * After a submit-like click, wait briefly for the first XHR/fetch it triggers and
 * patch the recorded action with a stable path so the compiler emits waitForResponse.
 */
function captureNetworkWaitFor(action: RecordedAction): void {
  const since = performance.now();
  setTimeout(() => {
    const triggered = recentNetworkEntries.find((entry) => entry.startTime >= since - 50);
    if (!triggered) return;
    const path = stableNetworkPath(triggered.url);
    if (!path) return;
    chrome.runtime.sendMessage({
      type: "UPDATE_ACTION",
      actionId: action.id,
      networkWaitUrl: path
    } satisfies ExtensionMessage);
  }, 1_200);
}

/** Reduce a full URL to a stable path fragment (no origin, no query string). */
function stableNetworkPath(url: string): string | undefined {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname && parsed.pathname !== "/") return parsed.pathname;
  } catch { /* not a parseable URL */ }
  return undefined;
}

// ─── Browser Test Replay ─────────────────────────────────────────────────────

async function executeTestAction(action: RecordedAction): Promise<{ ok: boolean; error?: string; skipped?: boolean; message?: string }> {
  try {
    await waitForPageReady(action.timeout ?? 10_000);
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
        const wanted = (action.value ?? "").trim();
        if (!wanted) {
          return { ok: false, error: "Select step has no value to choose." };
        }
        const element = await findReplayElement(action);
        if (element instanceof HTMLSelectElement) {
          // Prefer an exact match (by visible text or value) before falling back to substring.
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
        (element as HTMLElement).click();
        const option = await findByText(wanted, 5_000);
        (option as HTMLElement).click();
        return { ok: true };
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

async function waitForPageReady(timeout: number, options: { afterAction?: boolean } = {}): Promise<void> {
  const deadline = Date.now() + Math.max(timeout, 1_000);
  if (options.afterAction) {
    await sleep(PAGE_READY_INITIAL_SETTLE_MS);
  }

  await waitForDocumentComplete(deadline);
  await waitForNoVisibleLoading(deadline);
  await waitForDomQuiet(deadline, PAGE_READY_QUIET_MS);
}

async function waitForDocumentComplete(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      return;
    }
    await sleep(50);
  }
  throw new Error("Page did not reach a ready document state before the step timeout.");
}

async function waitForNoVisibleLoading(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (!hasVisibleLoadingIndicator()) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Page still shows a loading indicator after the step timeout.");
}

async function waitForDomQuiet(deadline: number, quietMs: number): Promise<void> {
  let lastMutation = Date.now();
  const observer = new MutationObserver(() => {
    lastMutation = Date.now();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  try {
    while (Date.now() < deadline) {
      if (Date.now() - lastMutation >= quietMs && !hasVisibleLoadingIndicator()) {
        return;
      }
      await sleep(75);
    }
  } finally {
    observer.disconnect();
  }

  throw new Error("Page did not settle before the step timeout.");
}

function hasVisibleLoadingIndicator(): boolean {
  return Array.from(document.querySelectorAll(PAGE_READY_LOADING_SELECTORS)).some((element) => {
    if (!isElementVisible(element)) return false;
    const text = visibleText(element).toLowerCase();
    if (text.includes("loaded") || text.includes("not loading")) return false;
    return true;
  });
}

function hasUsableSelector(selectors: SelectorStrategy): boolean {
  return Boolean(selectors.role || selectors.label || selectors.text || selectors.testId || selectors.css);
}

async function evaluatePreflightCondition(action: RecordedAction): Promise<{ skip: boolean; message?: string }> {
  // Compound predicate guard (mirrors the backend evalPredicate against the DOM).
  if (action.guard && !(await evalPredicateDom(action.guard))) {
    return {
      skip: true,
      message: action.guardElse === "skipAccount" ? "Guard not satisfied; skip account" : "Guard not satisfied"
    };
  }

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

/** DOM mirror of the backend evalPredicate, for preflight guard evaluation. */
async function evalPredicateDom(predicate: any): Promise<boolean> {
  if (!predicate || predicate.kind === "always") return true;
  const sel = (selectors: SelectorStrategy) => findReplayElementSync({ selectors } as RecordedAction);
  switch (predicate.kind) {
    case "and":
      return (await Promise.all((predicate.operands ?? []).map(evalPredicateDom))).every(Boolean);
    case "or":
      return (await Promise.all((predicate.operands ?? []).map(evalPredicateDom))).some(Boolean);
    case "not":
      return !(await evalPredicateDom(predicate.operand));
    case "urlContains":
      return window.location.href.includes(predicate.text ?? "");
    case "textVisible":
      return visibleText(document.body).toLowerCase().includes(String(predicate.text ?? "").toLowerCase());
    case "elementVisible": {
      const el = sel(predicate.selector);
      return Boolean(el && isElementVisible(el));
    }
    case "fieldEmpty": {
      const el = sel(predicate.selector);
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.trim() === "" : false;
    }
    case "fieldValue": {
      const el = sel(predicate.selector);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
      if (predicate.equals !== undefined) return el.value === predicate.equals;
      if (predicate.contains !== undefined) return el.value.includes(predicate.contains);
      return el.value.trim() !== "";
    }
    default:
      return true;
  }
}

async function testSelector(action: RecordedAction): Promise<SelectorTestResult> {
  try {
    const candidates = action.selectorCandidates?.length
      ? action.selectorCandidates
      : buildCandidatesFromLegacyAction(action);
    const ranked = testSelectorCandidatesInDocument(candidates, document);

    const chosen = findReplayElementSync(action);
    if (chosen) {
      highlightElement(chosen);
    }

    return {
      actionId: action.id,
      matchedCount: ranked[0]?.diagnostics?.matchedCount ?? 0,
      visibleCount: ranked[0]?.diagnostics?.visibleCount ?? 0,
      chosenPreview: chosen ? elementPreview(chosen) : undefined,
      chosenSelector: ranked[0] ? candidateLabel(ranked[0]) : undefined,
      fallbackCandidates: ranked.map(candidateResult)
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

async function pickSelector(action: RecordedAction): Promise<SelectorPickResult> {
  activeSelectorPick?.cancel("Replaced by a newer target picker.");

  return await new Promise<SelectorPickResult>((resolve) => {
    let currentTarget: Element | undefined;

    const finish = (result: SelectorPickResult): void => {
      cleanup();
      resolve(result);
    };
    const cancel = (message: string): void => {
      finish({ actionId: action.id, selectors: action.selectors, error: message });
    };
    const onPointerMove = (event: MouseEvent): void => {
      const target = pickableTargetAtPoint(event, action.type);
      if (!target || isRecorderUI(target)) return;
      currentTarget = target;
      showPickerHighlight(target);
    };
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = pickableTargetAtPoint(event, action.type) ?? currentTarget;
      if (!target || isRecorderUI(target)) {
        cancel("No selectable page element was found under the pointer.");
        return;
      }

      const selectors = extractedSelectorsForTarget(target);
      const rankedCandidates = testSelectorCandidatesInDocument(buildSelectorCandidatesForElement(target), document, target);
      const recommended = rankedCandidates[0];
      const persistedCandidates = stripRuntimeScores(rankedCandidates);
      highlightElement(target);
      finish({
        actionId: action.id,
        selectors: recommended?.selector ?? selectors,
        selectorCandidates: persistedCandidates,
        selectedCandidateId: recommended?.id,
        frameSelector,
        preview: elementPreview(target),
        description: describePickedTarget(action, target, recommended?.selector ?? selectors),
        value: pickedValue(action, target)
      });
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel("Target picker cancelled.");
    };
    const cleanup = (): void => {
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      hidePickerInstruction();
      clearPickerHighlight();
      if (activeSelectorPick?.cancel === cancel) {
        activeSelectorPick = undefined;
      }
    };

    activeSelectorPick = { cancel };
    showPickerInstruction(action);
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.setTimeout(() => {
      if (activeSelectorPick?.cancel === cancel) {
        cancel("Target picker timed out.");
      }
    }, 30_000);
  });
}

async function pickAnchor(action: RecordedAction): Promise<AnchorPickResult> {
  activeSelectorPick?.cancel("Replaced by a newer anchor picker.");

  return await new Promise<AnchorPickResult>((resolve) => {
    let currentTarget: Element | undefined;

    const finish = (result: AnchorPickResult): void => {
      cleanup();
      resolve(result);
    };
    const cancel = (message: string): void => {
      finish({ actionId: action.id, error: message });
    };
    const onPointerMove = (event: MouseEvent): void => {
      const target = semanticPickTarget(event.target as Element);
      if (!target || isRecorderUI(target)) return;
      currentTarget = target;
      showPickerHighlight(target);
    };
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = currentTarget ?? semanticPickTarget(event.target as Element);
      if (!target || isRecorderUI(target)) {
        cancel("No anchor text was selected.");
        return;
      }

      const anchor = computeAnchor(target) ?? anchorFromPickedElement(target);
      if (!anchor) {
        cancel("Pick stable text inside a row, dialog, form, or section.");
        return;
      }

      highlightElement(target);
      finish({
        actionId: action.id,
        anchor,
        preview: elementPreview(target)
      });
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel("Anchor picker cancelled.");
    };
    const cleanup = (): void => {
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      hidePickerInstruction();
      clearPickerHighlight();
      if (activeSelectorPick?.cancel === cancel) {
        activeSelectorPick = undefined;
      }
    };

    activeSelectorPick = { cancel };
    showPickerInstruction(action, "anchor");
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.setTimeout(() => {
      if (activeSelectorPick?.cancel === cancel) {
        cancel("Anchor picker timed out.");
      }
    }, 30_000);
  });
}

function pickableTargetAtPoint(event: MouseEvent, actionType: RecordedAction["type"]): Element | undefined {
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (isRecorderUI(element)) continue;
    const target = pickableTarget(element, actionType, { allowSemanticFallback: false });
    if (target) return target;
  }
  return pickableTarget(event.target as Element | null, actionType);
}

function pickableTarget(
  element: Element | null,
  actionType: RecordedAction["type"],
  options: { allowSemanticFallback?: boolean } = {}
): Element | undefined {
  if (!element) return undefined;
  const allowSemanticFallback = options.allowSemanticFallback !== false;
  if (actionType === "assert") {
    return assertionTarget(element) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  const checkbox = actionType === "click" ? checkboxTarget(element) : undefined;
  if (checkbox) return checkbox;

  if (actionType === "fill") {
    return element.closest("input, textarea, [contenteditable='true'], [role='textbox']") ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  if (actionType === "select") {
    return element.closest(
      "select, [role='combobox'], [role='option'], [class*='cpzui-select'], [class*='cpzui-virtual-filter-select']"
    ) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  if (actionType === "press") {
    return element.closest("input, textarea, button, a, [role='button'], [role='textbox'], [tabindex]") ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  return element.closest(
    `button, a, input[type='button'], input[type='submit'], ${CHECKBOX_TARGET_SELECTOR}, [role='button'], [role='link'], [aria-expanded], [class*='cpzui-button']`
  ) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
}

function checkboxTarget(element: Element): Element | undefined {
  const direct = element.closest(CHECKBOX_TARGET_SELECTOR);
  if (direct) return bestCheckboxTarget(direct);

  const row = element.closest('tr, [role="row"], li, [role="listitem"]');
  const rowCheckbox = row?.querySelector(CHECKBOX_TARGET_SELECTOR);
  return rowCheckbox ? bestCheckboxTarget(rowCheckbox) : undefined;
}

function bestCheckboxTarget(element: Element): Element {
  const label = element.closest("label");
  if (label && isElementVisible(label)) return label;
  const visibleWrapper = element.closest('[role="checkbox"], [class*="checkbox"], [class*="Checkbox"], [class*="cpzui-checkbox"], [class*="zm-checkbox"], [class*="zmu-checkbox"]');
  if (visibleWrapper && isElementVisible(visibleWrapper)) return visibleWrapper;
  return element;
}

function assertionTarget(element: Element): Element | undefined {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    if (isMeaningfulAssertionTarget(current)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return undefined;
}

function isMeaningfulAssertionTarget(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (["html", "body", "main", "form", "table", "thead", "tbody", "tr"].includes(tag)) return false;
  if (!isElementVisible(element)) return false;

  const text = visibleText(element);
  if (text.length < 2 || text.length > 120) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;

  if (element.matches("a, button, td, th, span, strong, p, label, [role='link'], [role='button'], [role='gridcell'], [role='cell'], [data-testid]")) {
    return true;
  }

  return element.children.length === 0;
}

function semanticPickTarget(element: Element): Element {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    if (
      current.matches("button, a, input, textarea, select, [role], [aria-label], [data-testid]") ||
      /cpzui-(button|select|virtual-filter-select|checkbox|tab)|zm-checkbox|zmu-checkbox|checkbox/i.test(String(current.className ?? ""))
    ) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return element;
}

function anchorFromPickedElement(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const container = element.closest('tr, [role="row"], li, [role="listitem"]');
  if (!container) return undefined;

  const scopeRole = container.tagName === "TR" || container.getAttribute("role") === "row" ? "row" : "listitem";
  const text = manualAnchorText(element, container);
  if (!text) return undefined;
  return { scopeRole, text, relationship: "within" };
}

function manualAnchorText(element: Element, container: Element): string | undefined {
  const ownText = visibleText(element);
  if (ownText.length > 1 && ownText.length <= 80) return ownText;

  const candidates = Array.from(container.querySelectorAll("td, th, [role='gridcell'], [role='cell'], span, strong, a"))
    .map((candidate) => visibleText(candidate))
    .filter((text) => text.length > 1 && text.length <= 80);
  const email = candidates.find((text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text));
  return email ?? candidates[0];
}

function extractedSelectorsForTarget(target: Element): SelectorStrategy {
  let selectors = extractSelectors(target);
  const nth = computeNth(target, selectors);
  if (nth !== undefined) {
    selectors = { ...selectors, nth };
  }
  const anchor = computeAnchor(target);
  if (anchor) {
    selectors = { ...selectors, anchor };
  }
  return selectors;
}

function describePickedTarget(action: RecordedAction, target: Element, selectors: SelectorStrategy): string {
  const label = selectors.role?.name ?? selectors.label ?? selectors.text ?? elementPreview(target);
  if (action.type === "assert") return `Assert text visible: ${assertionText(target) ?? label}`;
  if (action.type === "fill") return `Fill "${label}"`;
  if (action.type === "select") return `Select option in "${label}"`;
  if (action.type === "press") return `Press ${action.key ?? "Enter"}${label ? ` in "${label}"` : ""}`;
  return `Click "${label}"`;
}

function pickedValue(action: RecordedAction, target: Element): string | undefined {
  if (action.type === "assert") return assertionText(target);
  if (action.type !== "select") return undefined;
  if (target instanceof HTMLOptionElement) return target.text.trim() || target.value;
  if (target.getAttribute("role") === "option") return visibleText(target);
  return undefined;
}

function assertionText(target: Element): string | undefined {
  const text = visibleText(target).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 120 ? text.slice(0, 120).trim() : text;
}

function showPickerInstruction(action: RecordedAction, mode: "target" | "anchor" = "target"): void {
  const existing = document.getElementById("__zoom_recorder_picker_instruction");
  if (existing) existing.remove();
  const instruction = document.createElement("div");
  instruction.id = "__zoom_recorder_picker_instruction";
  instruction.textContent = mode === "anchor"
    ? "Click stable row/list text to anchor this step. Press Esc to cancel."
    : `Click the ${pickerNoun(action.type)} to use for this step. Press Esc to cancel.`;
  instruction.style.cssText = [
    "position: fixed",
    "top: 8px",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 999999",
    "background: #0b5cff",
    "color: white",
    "padding: 7px 14px",
    "border-radius: 18px",
    "font-family: system-ui, sans-serif",
    "font-size: 12px",
    "font-weight: 700",
    "box-shadow: 0 2px 10px rgba(0,0,0,0.24)",
    "pointer-events: none"
  ].join(";");
  document.body.appendChild(instruction);
}

function pickerNoun(actionType: RecordedAction["type"]): string {
  if (actionType === "assert") return "text or element to validate";
  if (actionType === "fill") return "field";
  if (actionType === "select") return "dropdown or option";
  if (actionType === "press") return "field or control";
  return "button or link";
}

function hidePickerInstruction(): void {
  document.getElementById("__zoom_recorder_picker_instruction")?.remove();
}

function showPickerHighlight(element: Element): void {
  const id = "__zoom_recorder_picker_highlight";
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText = [
      "position: fixed",
      "border: 3px solid #0b5cff",
      "box-shadow: 0 0 0 3px rgba(11,92,255,0.22)",
      "border-radius: 6px",
      "z-index: 999998",
      "pointer-events: none"
    ].join(";");
    document.body.appendChild(overlay);
  }
  const rect = element.getBoundingClientRect();
  overlay.style.left = `${Math.max(rect.left - 3, 0)}px`;
  overlay.style.top = `${Math.max(rect.top - 3, 0)}px`;
  overlay.style.width = `${Math.max(rect.width + 6, 6)}px`;
  overlay.style.height = `${Math.max(rect.height + 6, 6)}px`;
}

function clearPickerHighlight(): void {
  document.getElementById("__zoom_recorder_picker_highlight")?.remove();
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
        const element = hasUsableSelector(action.selectors)
          ? findReplayElementSync(action)
          : document.querySelector(expected);
        return Boolean(element && isElementVisible(element));
      }, timeout, `Expected selector to be visible: ${expected}`);
      return;
    case "fieldValue":
    case "hasValue":
      await waitFor(() => {
        const fields = Array.from(document.querySelectorAll("input, textarea")) as Array<HTMLInputElement | HTMLTextAreaElement>;
        return fields.some((field) => field.value.includes(expected));
      }, timeout, `Expected a field value to contain "${expected}"`);
      return;
    case "tableRowContains":
      await waitFor(() => Array.from(document.querySelectorAll("tr")).some((row) => visibleText(row).includes(expected)), timeout, `Expected table row containing "${expected}"`);
      return;
    case "textVisible":
    case "hasText":
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

function resolveAnchorRoot(selectors: SelectorStrategy): Element | undefined {
  const anchor = selectors.anchor;
  if (!anchor?.text) return undefined;
  const scopeSelector = anchor.scopeSelector
    ?? (anchor.scopeRole === "dialog" ? "[role='dialog'], dialog"
      : anchor.scopeRole === "listitem" ? "li, [role='listitem']"
      : "tr, [role='row']");
  return Array.from(document.querySelectorAll(scopeSelector)).find(
    (container) => isElementVisible(container) && visibleText(container).toLowerCase().includes(anchor.text!.toLowerCase())
  );
}

function findReplayElementSync(action: RecordedAction): Element | undefined {
  const selectors = action.selectors;

  // Anchor: scope the search to the matching row before falling back to the page.
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

  if (selectors.css) {
    const element = pickElement(Array.from(document.querySelectorAll(selectors.css)), selectors.nth);
    if (element) return element;
  }
  if (selectors.testId) {
    const element = pickElement(Array.from(document.querySelectorAll(`[data-testid="${cssEscape(selectors.testId)}"]`)), selectors.nth);
    if (element) return element;
  }
  if (selectors.label) {
    const element = findByLabel(selectors.label);
    if (element) return element;
  }
  if (selectors.role) {
    const element = findByRole(selectors.role.role, selectors.role.name, document, selectors.nth);
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

function buildCandidatesFromLegacyAction(action: RecordedAction): SelectorCandidate[] {
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

function stripRuntimeScores(candidates: RankedSelectorCandidate[]): SelectorCandidate[] {
  return candidates.map(({ rank: _rank, score: _score, ...candidate }) => candidate);
}

function candidateResult(candidate: RankedSelectorCandidate): SelectorTestResult["fallbackCandidates"][number] {
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

function candidateLabel(candidate: RankedSelectorCandidate): string {
  return candidate.label ?? `${candidate.kind}: ${formatCandidateSelector(candidate.selector)}`;
}

function formatCandidateSelector(selectors: SelectorStrategy): string {
  return [
    selectors.role ? `role=${selectors.role.role}${selectors.role.name ? `/${selectors.role.name}` : ""}` : undefined,
    selectors.label ? `label=${selectors.label}` : undefined,
    selectors.testId ? `testId=${selectors.testId}` : undefined,
    selectors.text ? `text=${selectors.text}` : undefined,
    selectors.css ? `css=${selectors.css}` : undefined,
    selectors.xpath ? `xpath=${selectors.xpath}` : undefined
  ].filter(Boolean).join(" | ") || "selector";
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

function findByLabel(labelText: string, root: ParentNode = document): Element | undefined {
  const labels = Array.from(root.querySelectorAll("label"));
  for (const label of labels) {
    if (!visibleText(label).toLowerCase().includes(labelText.toLowerCase())) continue;
    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target && isElementVisible(target)) return target;
    }
    const nested = label.querySelector("input, textarea, select, button, [role='button'], [role='checkbox']");
    if (nested && isElementVisible(nested)) return nested;
  }

  const aria = Array.from(root.querySelectorAll("input, textarea, select, button, [aria-label]"));
  return aria.find((element) => (element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? "").toLowerCase().includes(labelText.toLowerCase()) && isElementVisible(element));
}

function findByRole(role: string, name?: string, root: ParentNode = document, nth?: number): Element | undefined {
  return pickElement(findAllByRole(role, name, root), nth);
}

function findAllByRole(role: string, name?: string, root: ParentNode = document): Element[] {
  const selectors = role === "button"
    ? "button, [role='button'], input[type='button'], input[type='submit']"
    : role === "textbox"
      ? "input, textarea, [role='textbox']"
      : role === "checkbox"
        ? CHECKBOX_TARGET_SELECTOR
        : `[role='${role}']`;
  return actionableElements(Array.from(root.querySelectorAll(selectors))).filter((element) => {
    if (!name) return true;
    const accessible = `${visibleText(element)} ${element.getAttribute("aria-label") ?? ""} ${(element as HTMLInputElement).value ?? ""} ${associatedCheckboxLabel(element) ?? ""}`.trim();
    return accessible.toLowerCase().includes(name.toLowerCase());
  });
}

function pickElement(elements: Element[], nth = 0): Element | undefined {
  const actionable = actionableElements(elements);
  return actionable[nth] ?? actionable[0];
}

function actionableElements(elements: Element[]): Element[] {
  return elements
    .map((element) => isCheckboxLike(element) ? bestCheckboxTarget(element) : element)
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(isElementVisible);
}

function isCheckboxLike(element: Element): boolean {
  return element.matches(CHECKBOX_TARGET_SELECTOR) || Boolean(element.closest(CHECKBOX_TARGET_SELECTOR));
}

function associatedCheckboxLabel(element: Element): string | undefined {
  const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null);
  return label?.textContent?.replace(/\s+/g, " ").trim();
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
  return Boolean(el.closest("#__zoom_recorder_indicator, #__zoom_recorder_picker_instruction, #__zoom_recorder_picker_highlight"));
}

/**
 * Heuristic: does clicking this element trigger a browser download? (feature 7)
 */
function isDownloadTrigger(target: Element, text: string | undefined): boolean {
  const anchor = target.closest("a");
  if (anchor) {
    if (anchor.hasAttribute("download")) return true;
    const href = anchor.getAttribute("href") ?? "";
    if (/\.(csv|pdf|xlsx?|zip|json|txt|docx?)(\?|$)/i.test(href)) return true;
  }
  return /\b(download|export)\b/i.test(text ?? "");
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
