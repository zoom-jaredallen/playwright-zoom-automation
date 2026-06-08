import { extractSelectors, getFieldContext, getAriaState, getFrameSelector, computeNth, computeAnchor } from "../shared/selectors.js";
import { detectParameters } from "../shared/parameterizer.js";
import { shouldRecordNavigationUrl } from "../shared/navigationPolicy.js";
import { insertRecordedAction } from "../shared/recordedActionPolicy.js";
import { buildZoomComboboxSelection } from "../shared/zoomCombobox.js";
import type { RecordedAction, ExtensionMessage, ActionType } from "../shared/types.js";
import { actionLabel, captureMetadataForTarget, currentFrameContext, highlightActionTarget } from "./actionContext.js";
import {
  closestZoomComboboxTrigger,
  detectImpersonationContext,
  generateId,
  getOptionText,
  inputElementValue,
  isDownloadTrigger,
  isElementVisible,
  isInputElement,
  isInsideDropdownList,
  isLoginOrImpersonationUrl,
  isRecorderUI,
  isSameOrChildOf,
  normalizedOptionElement,
  visibleText
} from "./domHelpers.js";
import { captureNetworkWaitFor, startNetworkObserver, SUBMIT_LABEL_PATTERN } from "./networkCapture.js";
import { waitForPageReady } from "./pageReadiness.js";
import { hideRecordingIndicator, showRecordingIndicator } from "./recordingIndicator.js";
import { isSelectorPicking, pickAnchor, pickSelector } from "./selectorPicker.js";
import { createFillDebouncer } from "./fillDebouncer.js";
import {
  buildCandidatesFromLegacyAction,
  candidateLabel,
  candidateResult,
  executeTestAction,
  findReplayElementSync,
  formatCandidateSelector,
  locateReplayElement,
  locateReplayOption,
  verifyReplaySelect
} from "./replayRunner.js";
import { rankSelectorCandidatesForTarget, selectorDiagnosticsForTarget, testSelector } from "./selectorDiagnostics.js";

let recording = false;
let paused = false;
let listenersAttached = false;
let actionQueue: RecordedAction[] = [];
let impersonationDetected = false;
const fillDebouncer = createFillDebouncer(recordFillFromElement);

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

startNetworkObserver();

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
    fillDebouncer.flush();
    showRecordingIndicator(paused);
    sendResponse({ ok: true });
  } else if (message.type === "RESUME_RECORDING") {
    paused = false;
    showRecordingIndicator(paused);
    sendResponse({ ok: true });
  } else if (message.type === "GET_STATUS") {
    sendResponse({ recording, paused, actionCount: actionQueue.length });
  } else if (message.type === "WAIT_FOR_PAGE_READY") {
    void waitForPageReady(message.timeout ?? 10_000, { afterAction: message.afterAction }).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  } else if (message.type === "EXECUTE_TEST_ACTION") {
    void executeTestAction(message.action).then(sendResponse);
  } else if (message.type === "LOCATE_TEST_ACTION_TARGET") {
    void locateReplayElement(message.action).then(sendResponse);
  } else if (message.type === "LOCATE_TEST_ACTION_OPTION") {
    void locateReplayOption(message.action, message.optionText).then(sendResponse);
  } else if (message.type === "VERIFY_TEST_ACTION_SELECT") {
    void verifyReplaySelect(message.action, message.expected).then(sendResponse);
  } else if (message.type === "TEST_SELECTOR") {
    void testSelector(message.action).then(sendResponse);
  } else if (message.type === "HIGHLIGHT_ACTION_TARGET") {
    void highlightActionTarget(message.action).then(sendResponse);
  } else if (message.type === "PICK_SELECTOR") {
    void pickSelector(message.action, frameSelector).then(sendResponse);
  } else if (message.type === "PICK_ANCHOR") {
    void pickAnchor(message.action).then(sendResponse);
  }
  return true;
});

// ─── Recording Control ───────────────────────────────────────────────────────

function startRecording(): void {
  if (recording) {
    paused = false;
    attachListeners();
    showRecordingIndicator(paused);
    return;
  }

  recording = true;
  paused = false;
  actionQueue = [];
  impersonationDetected = detectImpersonationContext();
  attachListeners();
  showRecordingIndicator(paused);
  
  // Record initial navigation (skip if it's a login/impersonation page)
  if (!isLoginOrImpersonationUrl(window.location.href) && shouldRecordNavigationUrl(window.location.href, currentFrameContext())) {
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
  fillDebouncer.flush();
  detachListeners();
  hideRecordingIndicator();
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function attachListeners(): void {
  if (listenersAttached) return;
  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  document.addEventListener("keydown", handleKeydown, true);
  if (RECORD_HOVER_STEPS_BY_DEFAULT) {
    document.addEventListener("mouseover", handleMouseOver, true);
  }
  window.addEventListener("hashchange", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
  listenersAttached = true;
}

function detachListeners(): void {
  if (!listenersAttached) return;
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("change", handleChange, true);
  document.removeEventListener("keydown", handleKeydown, true);
  if (RECORD_HOVER_STEPS_BY_DEFAULT) {
    document.removeEventListener("mouseover", handleMouseOver, true);
  }
  window.removeEventListener("hashchange", handleNavigation);
  window.removeEventListener("popstate", handleNavigation);
  listenersAttached = false;
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function handleClick(event: MouseEvent): void {
  if (isSelectorPicking()) return;
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

  fillDebouncer.flush();

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
  const comboboxWrapper = closestZoomComboboxTrigger(target);
  if (comboboxWrapper && !isInsideDropdownList(target)) {
    const triggerSelectors = extractSelectors(comboboxWrapper);
    const fieldCtx = getFieldContext(comboboxWrapper);
    activeCombobox = {
      element: comboboxWrapper,
      label: fieldCtx.label ?? triggerSelectors.label ?? triggerSelectors.role?.name ?? selectors.label ?? selectors.role?.name,
      openedAt: now
    };
    // Don't record the "open combobox" click — we'll record the selection instead
    return;
  }

  // Skip clicks on input fields (they'll be captured as fill actions). This must
  // run after combobox detection because Zoom searchable selects place an input
  // inside the trigger.
  if (isInputElement(target)) return;

  // ─── Option Selection Detection ──────────────────────────────────────
  // If we have an active combobox and the user clicks an option, record as "select"
  if (activeCombobox && isInsideDropdownList(target)) {
    const optionText = getOptionText(target);
    if (optionText) {
      const fieldCtx = getFieldContext(activeCombobox.element);
      const params = detectParameters(optionText, fieldCtx);
      const optionElement = normalizedOptionElement(target);
      const selection = buildZoomComboboxSelection({
        triggerElement: activeCombobox.element,
        optionElement,
        optionText,
        label: activeCombobox.label
      });

      recordAction({
        type: "select",
        selectors: selection.selectors,
        selectorCandidates: selection.selectorCandidates,
        selectedCandidateId: selection.selectedCandidateId,
        selectorDiagnostics: selectorDiagnosticsForTarget(activeCombobox.element, selection.rankedTriggerCandidates[0]),
        capture: captureMetadataForTarget(activeCombobox.element),
        selectMetadata: selection.selectMetadata,
        intentType: selection.intentType,
        intentMetadata: selection.intentMetadata,
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
  if (isSelectorPicking()) return;
  if (!recording || paused) return;
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target || !isInputElement(target)) return;
  if (isRecorderUI(target)) return;

  fillDebouncer.queue(target);
}

function handleChange(event: Event): void {
  if (isSelectorPicking()) return;
  if (!recording || paused) return;
  const target = event.target as HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;
  if (isRecorderUI(target)) return;

  if (isInputElement(target)) {
    fillDebouncer.queue(target);
    fillDebouncer.flush();
    return;
  }

  if (target.tagName.toLowerCase() !== "select") return;

  fillDebouncer.flush();

  const select = target as HTMLSelectElement;
  const selectors = extractSelectors(select);
  const selectedText = select.options[select.selectedIndex]?.text ?? select.value;
  const fieldCtx = getFieldContext(select);
  const params = detectParameters(selectedText, fieldCtx);

  recordAction({
    type: "select",
    selectors,
    value: selectedText,
    intentType: "zoom.selectComboboxOption",
    intentMetadata: {
      fieldLabel: selectors.label ?? selectors.role?.name,
      optionLabel: selectedText,
      confidence: selectors.label ?? selectors.role?.name ? "high" : "medium",
      source: "recorded"
    },
    parameterHints: params.length > 0 ? params : undefined,
    description: `Select "${selectedText}" in ${selectors.label ?? selectors.role?.name ?? "dropdown"}`
  }, select);
}

// Keys captured as explicit "press" actions (feature 4). Enter on a button is
// still recorded as a click below for fidelity with user intent.
const PRESS_KEYS = new Set(["Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp"]);

function handleKeydown(event: KeyboardEvent): void {
  if (isSelectorPicking()) return;
  if (!recording || paused) return;
  const target = event.target as Element;

  // Capture Enter key. On a button/link it's an explicit click; elsewhere (e.g.
  // submitting a search field) record it as a press so the action isn't lost.
  if (event.key === "Enter") {
    if (!target || isRecorderUI(target)) return;
    fillDebouncer.flush();
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
    const flushedFill = fillDebouncer.flush();
    if (event.key === "Tab" && isInputElement(target)) {
      if (!flushedFill) {
        fillDebouncer.recordNow(target, inputElementValue(target));
      }
      return;
    }

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
  if (isSelectorPicking()) return;
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

  if (!shouldRecordNavigationUrl(window.location.href, currentFrameContext())) {
    return;
  }

  // Detect if we just entered an impersonated context
  if (!impersonationDetected && detectImpersonationContext()) {
    impersonationDetected = true;
    // Don't record this navigation — the engine handles impersonation
    return;
  }

  fillDebouncer.flush();
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

function recordFillFromElement(target: Element, value: string): boolean {
  if (!value) return false;

  const selectors = extractSelectors(target);
  const fieldCtx = getFieldContext(target);
  const params = detectParameters(value, fieldCtx);

  recordAction({
    type: "fill",
    selectors,
    value,
    intentType: "zoom.fillFieldByLabel",
    intentMetadata: {
      fieldLabel: selectors.label ?? selectors.role?.name,
      expectedOutcome: value,
      confidence: selectors.label ?? selectors.role?.name ? "high" : "medium",
      source: "recorded"
    },
    parameterHints: params.length > 0 ? params : undefined,
    description: `Fill "${selectors.label ?? selectors.role?.name ?? "field"}" with "${value.slice(0, 30)}${value.length > 30 ? "…" : ""}"`
  }, target);

  return true;
}

// ─── Action Recording ────────────────────────────────────────────────────────

function recordAction(
  partial: Partial<RecordedAction> & { type: ActionType; selectors: RecordedAction["selectors"] },
  targetElement?: Element
): void {
  if (partial.type === "navigate" && !shouldRecordNavigationUrl(partial.url ?? window.location.href, currentFrameContext())) {
    return;
  }

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

  if (targetElement) {
    const rankedCandidates = rankSelectorCandidatesForTarget(targetElement);
    const recommended = rankedCandidates[0];
    partial.selectorCandidates = rankedCandidates.map(({ rank: _rank, score: _score, ...candidate }) => candidate);
    partial.selectedCandidateId = recommended?.id;
    partial.selectorDiagnostics = selectorDiagnosticsForTarget(targetElement, recommended);
    partial.capture = captureMetadataForTarget(targetElement);
  }

  const action: RecordedAction = {
    id: generateId(),
    timestamp: Date.now(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    ...partial
  };

  const nextQueue = insertRecordedAction(actionQueue, action);
  if (nextQueue === actionQueue) {
    return;
  }
  actionQueue = nextQueue;

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
