/**
 * Content script that captures user interactions in the Zoom admin portal.
 * Runs on all zoom.us pages. Only actively records when told to by the
 * background service worker.
 */
import { extractSelectors, getFieldContext } from "../shared/selectors.js";
import { detectParameters } from "../shared/parameterizer.js";
import type { RecordedAction, ExtensionMessage, ActionType } from "../shared/types.js";

let recording = false;
let actionQueue: RecordedAction[] = [];
let lastFillTimeout: ReturnType<typeof setTimeout> | undefined;
let lastFillElement: Element | null = null;
let lastFillValue = "";

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    startRecording();
    sendResponse({ ok: true });
  } else if (message.type === "STOP_RECORDING") {
    stopRecording();
    sendResponse({ ok: true });
  } else if (message.type === "GET_STATUS") {
    sendResponse({ recording, actionCount: actionQueue.length });
  }
  return true;
});

// ─── Recording Control ───────────────────────────────────────────────────────

function startRecording(): void {
  recording = true;
  actionQueue = [];
  attachListeners();
  showRecordingIndicator();
  
  // Record initial navigation
  recordAction({
    type: "navigate",
    url: window.location.href,
    selectors: {},
    description: `Navigate to ${document.title}`
  });
}

function stopRecording(): void {
  recording = false;
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
  if (!recording) return;
  const target = event.target as Element;
  if (!target || isRecorderUI(target)) return;

  flushPendingFill();

  // Skip clicks on input fields (they'll be captured as fill actions)
  if (isInputElement(target)) return;

  const selectors = extractSelectors(target);
  const text = target.textContent?.trim().slice(0, 60);
  
  // Detect file upload clicks
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

  recordAction({
    type: "click",
    selectors,
    description: `Click "${text ?? selectors.role?.name ?? "element"}"`
  });
}

function handleInput(event: Event): void {
  if (!recording) return;
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
  if (!recording) return;
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
  if (!recording) return;
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
  if (!recording) return;
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
  if (document.getElementById("__zoom_recorder_indicator")) return;
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
      Recording workflow…
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

function isRecorderUI(el: Element): boolean {
  return Boolean(el.closest("#__zoom_recorder_indicator"));
}

function generateId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
