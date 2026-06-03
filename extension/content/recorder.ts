/**
 * Content script that captures user interactions in the Zoom admin portal.
 * Runs on all zoom.us pages. Only actively records when told to by the
 * background service worker.
 */
import { extractSelectors, getFieldContext } from "../shared/selectors.js";
import { detectParameters } from "../shared/parameterizer.js";
import type { RecordedAction, ExtensionMessage, ActionType } from "../shared/types.js";

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
