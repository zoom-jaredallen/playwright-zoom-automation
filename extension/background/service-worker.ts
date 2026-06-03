/**
 * Background service worker that aggregates recorded actions from the content
 * script, manages recording state, and generates the final workflow JSON.
 */
import type { ExtensionMessage, RecordedAction, RecordedWorkflow, WorkflowAssertion, WorkflowParameter } from "../shared/types.js";

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let recordingStartTime = 0;
let recordingStartUrl = "";
let impersonationDetected = false;

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  switch (message.type) {
    case "START_RECORDING":
      void startRecording(message).then(sendResponse);
      break;

    case "STOP_RECORDING":
      void stopRecording(message).then(sendResponse);
      break;

    case "PAUSE_RECORDING":
      void setPaused(true).then(sendResponse);
      break;

    case "RESUME_RECORDING":
      void setPaused(false).then(sendResponse);
      break;

    case "ACTION_RECORDED":
      if (recording && !paused) {
        // Detect impersonation context from the first action's description
        if (message.action.description?.includes("sub-account context")) {
          impersonationDetected = true;
        }
        // Filter out meta-only actions (impersonation detection notices)
        if (!message.action.id.startsWith("meta_")) {
          actions.push(message.action);
        }
        if (!recordingStartUrl && message.action.type === "navigate" && message.action.url) {
          recordingStartUrl = message.action.url;
        }
        updateBadge();
        broadcastRecorderState();
      }
      sendResponse({ ok: true });
      break;

    case "GET_STATUS":
      sendResponse({ recording, paused, actionCount: actions.length });
      break;

    case "GET_ACTIONS":
      sendResponse({ actions });
      break;

    case "BUILD_WORKFLOW":
      sendResponse({ workflow: buildWorkflow() });
      break;

    case "DELETE_ACTION":
      actions = actions.filter((a) => a.id !== message.actionId);
      updateBadge();
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "UPDATE_ACTION":
      updateAction(message.actionId, {
        description: message.description,
        cssSelector: message.cssSelector,
        selectorNote: message.selectorNote
      });
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "MOVE_ACTION":
      moveAction(message.actionId, message.direction);
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "ADD_NAVIGATION_ACTION":
      addNavigationAction(message.url);
      updateBadge();
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "ADD_ASSERTION_ACTION":
      addAssertionAction(message.assertionType, message.expected, message.timeout, message.onFailure);
      updateBadge();
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "ADD_SCREENSHOT_ACTION":
      addScreenshotAction(message.label);
      updateBadge();
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "ADD_WAIT_ACTION":
      addWaitAction(message.waitMs);
      updateBadge();
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "CLEAR_ACTIONS":
      actions = [];
      recordingStartUrl = "";
      recordingStartTime = Date.now();
      paused = false;
      updateBadge();
      chrome.storage.local.remove(["lastWorkflow", "lastActions"]);
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    case "UPDATE_PARAMETER":
      const action = actions.find((a) => a.id === message.actionId);
      if (action?.parameterHints?.[message.paramIndex]) {
        action.parameterHints[message.paramIndex].confirmed = message.confirmed;
      }
      broadcastRecorderState();
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false, error: "Unknown message type" });
  }
  return true;
});

async function startRecording(message: Extract<ExtensionMessage, { type: "START_RECORDING" }>): Promise<{ ok: boolean; error?: string }> {
  const tab = await getActiveTab();
  if (!tab.id) {
    return { ok: false, error: "No active tab found" };
  }

  recording = true;
  paused = false;
  actions = [];
  impersonationDetected = false;
  recordingStartTime = Date.now();
  recordingStartUrl = "";
  updateBadge();

  try {
    await ensureContentRecorder(tab.id);
    await chrome.tabs.sendMessage(tab.id, message);
    broadcastRecorderState();
    return { ok: true };
  } catch (error) {
    recording = false;
    paused = false;
    updateBadge();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function stopRecording(message: Extract<ExtensionMessage, { type: "STOP_RECORDING" }>): Promise<{ ok: boolean; workflow?: RecordedWorkflow; error?: string }> {
  try {
    const tab = await getActiveTab();
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
    }
  } finally {
    recording = false;
    paused = false;
    updateBadge();
  }

  const workflow = buildWorkflow();
  await chrome.storage.local.set({ lastWorkflow: workflow, lastActions: actions });
  broadcastRecorderState();
  return { ok: true, workflow };
}

async function setPaused(nextPaused: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!recording) {
    return { ok: false, error: "Recording is not active" };
  }

  paused = nextPaused;
  const tab = await getActiveTab().catch(() => undefined);
  if (tab?.id) {
    await chrome.tabs
      .sendMessage(tab.id, { type: nextPaused ? "PAUSE_RECORDING" : "RESUME_RECORDING" } satisfies ExtensionMessage)
      .catch(() => undefined);
  }
  broadcastRecorderState();
  return { ok: true };
}

function updateAction(actionId: string, update: { description?: string; cssSelector?: string; selectorNote?: string }): void {
  const action = actions.find((candidate) => candidate.id === actionId);
  if (!action) return;

  if (update.description !== undefined) {
    action.description = update.description;
  }
  if (update.cssSelector !== undefined) {
    const cssSelector = update.cssSelector.trim();
    if (cssSelector) {
      action.selectors.css = cssSelector;
    } else {
      delete action.selectors.css;
    }
  }
  if (update.selectorNote !== undefined) {
    action.selectorNote = update.selectorNote.trim() || undefined;
  }
}

function moveAction(actionId: string, direction: "up" | "down"): void {
  const currentIndex = actions.findIndex((action) => action.id === actionId);
  if (currentIndex === -1) return;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= actions.length) return;

  const [action] = actions.splice(currentIndex, 1);
  actions.splice(nextIndex, 0, action);
}

function addNavigationAction(rawUrl: string): void {
  const url = normalizeNavigationUrl(rawUrl);
  const action: RecordedAction = {
    id: `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    type: "navigate",
    selectors: {},
    url,
    pageUrl: url,
    pageTitle: "Manual navigation",
    description: `Navigate to ${url}`
  };

  actions.push(action);
  if (!recordingStartUrl) {
    recordingStartUrl = url;
  }
}

function addAssertionAction(
  assertionType: RecordedAction["assertionType"],
  expected: string,
  timeout = 10_000,
  onFailure: RecordedAction["onFailure"] = "screenshot"
): void {
  const normalizedType = assertionType ?? "textVisible";
  const action: RecordedAction = {
    id: createManualActionId("assert"),
    timestamp: Date.now(),
    type: "assert",
    selectors: {},
    assertionType: normalizedType,
    expected: expected.trim(),
    timeout,
    onFailure,
    pageUrl: recordingStartUrl,
    pageTitle: "Manual assertion",
    description: `Assert ${formatAssertionType(normalizedType)}: ${expected.trim()}`
  };

  actions.push(action);
}

function addScreenshotAction(label?: string): void {
  const normalizedLabel = label?.trim() || "evidence";
  const action: RecordedAction = {
    id: createManualActionId("screenshot"),
    timestamp: Date.now(),
    type: "screenshot",
    selectors: {},
    screenshotLabel: normalizedLabel,
    pageUrl: recordingStartUrl,
    pageTitle: "Manual screenshot",
    description: `Take screenshot: ${normalizedLabel}`
  };

  actions.push(action);
}

function addWaitAction(waitMs: number): void {
  const normalizedWaitMs = Math.min(Math.max(Math.round(waitMs), 250), 60_000);
  const action: RecordedAction = {
    id: createManualActionId("wait"),
    timestamp: Date.now(),
    type: "wait",
    selectors: {},
    waitMs: normalizedWaitMs,
    pageUrl: recordingStartUrl,
    pageTitle: "Manual wait",
    description: `Wait ${normalizedWaitMs}ms`
  };

  actions.push(action);
}

function createManualActionId(prefix: string): string {
  return `manual_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatAssertionType(type: NonNullable<RecordedAction["assertionType"]>): string {
  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

function normalizeNavigationUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("/")) {
    return `https://zoom.us${value}`;
  }
  if (value.startsWith("#")) {
    return `https://zoom.us/cpw/page/phoneNumbers${value}`;
  }
  return `https://zoom.us/${value.replace(/^\/+/, "")}`;
}

// ─── Workflow Builder ────────────────────────────────────────────────────────

function buildWorkflow(): RecordedWorkflow {
  const parameters = extractParameters(actions);
  const assertions = generateAssertions(actions);
  const startUrl = extractRelativeStartUrl(recordingStartUrl);

  return {
    version: 1,
    meta: {
      name: "",
      description: generateDescription(actions),
      recordedAt: new Date().toISOString(),
      recordedOnUrl: recordingStartUrl,
      durationMs: Date.now() - recordingStartTime,
      category: inferCategory(actions)
    },
    parameters,
    actions: actions.map((action) => ({
      ...action,
      // Replace confirmed parameter values with template placeholders
      value: replaceWithPlaceholders(action)
    })),
    assertions,
    config: {
      startUrl,
      requiresImpersonation: impersonationDetected || true, // Default true for sub-account workflows
      defaultTimeout: 10_000,
      retryableErrors: [
        "timeout",
        "temporarily unavailable",
        "net::",
        "target closed"
      ]
    }
  };
}

function extractParameters(actions: RecordedAction[]): WorkflowParameter[] {
  const paramMap = new Map<string, WorkflowParameter>();

  for (const action of actions) {
    if (!action.parameterHints) continue;
    for (const hint of action.parameterHints) {
      if (hint.confirmed === false) continue; // User explicitly dismissed
      if (paramMap.has(hint.suggestedName)) continue;

      paramMap.set(hint.suggestedName, {
        name: hint.suggestedName,
        type: hint.reason === "looks_like_phone_number" ? "string" : "string",
        required: true,
        description: `Auto-detected: ${hint.reason.replace(/_/g, " ")}`,
        defaultValue: undefined,
        source: inferParameterSource(hint.suggestedName)
      });
    }
  }

  return Array.from(paramMap.values());
}

function inferParameterSource(paramName: string): WorkflowParameter["source"] {
  if (paramName.startsWith("address.")) return "addressProfile";
  if (paramName === "customerName") return "addressProfile";
  if (paramName.startsWith("contact.")) return "addressProfile";
  if (paramName === "contactEmail") return "addressProfile";
  if (paramName === "phoneNumber") return "config";
  return "prompt";
}

function generateAssertions(actions: RecordedAction[]): WorkflowAssertion[] {
  const assertions: WorkflowAssertion[] = [];

  for (const action of actions) {
    if (action.type === "assert" && action.expected && action.assertionType) {
      assertions.push({
        afterAction: action.id,
        type: action.assertionType === "tableRowContains" ? "textVisible" : action.assertionType,
        expected: action.expected,
        timeout: action.timeout ?? 10_000,
        onFailure: action.onFailure ?? "screenshot"
      });
    }

    // After click on Save/Submit buttons, add success assertion
    if (action.type === "click") {
      const name = action.selectors.role?.name ?? action.selectors.text ?? "";
      if (/save|submit|add|continue|confirm/i.test(name)) {
        assertions.push({
          afterAction: action.id,
          type: "textVisible",
          expected: "success|saved|added|submitted",
          timeout: 10_000,
          onFailure: "screenshot"
        });
      }
    }

    // After navigation, assert URL
    if (action.type === "navigate" && action.url) {
      const path = new URL(action.url).hash || new URL(action.url).pathname;
      assertions.push({
        afterAction: action.id,
        type: "urlContains",
        expected: path,
        timeout: 15_000,
        onFailure: "fail"
      });
    }
  }

  return assertions;
}

function replaceWithPlaceholders(action: RecordedAction): string | undefined {
  if (!action.value || !action.parameterHints) return action.value;

  let value = action.value;
  for (const hint of action.parameterHints) {
    if (hint.confirmed === false) continue;
    value = value.replace(hint.originalValue, `{{${hint.suggestedName}}}`);
  }
  return value;
}

function generateDescription(actions: RecordedAction[]): string {
  const fills = actions.filter((a) => a.type === "fill").length;
  const clicks = actions.filter((a) => a.type === "click").length;
  const navigations = actions.filter((a) => a.type === "navigate").length;
  const assertions = actions.filter((a) => a.type === "assert").length;
  const screenshots = actions.filter((a) => a.type === "screenshot").length;
  return `Recorded workflow: ${navigations} navigation(s), ${fills} field fill(s), ${clicks} click(s), ${assertions} assertion(s), ${screenshots} screenshot(s).`;
}

function inferCategory(actions: RecordedAction[]): RecordedWorkflow["meta"]["category"] {
  const urls = actions.map((a) => a.pageUrl).join(" ");
  if (/phoneNumbers|business-address|phone/i.test(urls)) return "phone";
  if (/settings|policy|policies/i.test(urls)) return "settings";
  if (/compliance|10dlc|brand/i.test(urls)) return "compliance";
  return "custom";
}

function extractRelativeStartUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return url.pathname + url.hash;
  } catch {
    return "/";
  }
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function updateBadge(): void {
  if (recording) {
    chrome.action.setBadgeText({ text: paused ? "II" : String(actions.length) });
    chrome.action.setBadgeBackgroundColor({ color: paused ? "#7a869a" : "#e53935" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function broadcastRecorderState(): void {
  chrome.runtime.sendMessage({
    type: "STATUS_RESPONSE",
    recording,
    paused,
    actionCount: actions.length
  } satisfies ExtensionMessage).catch(() => undefined);

  chrome.runtime.sendMessage({
    type: "RECORDER_STATE_UPDATED",
    recording,
    paused,
    actions
  } satisfies ExtensionMessage).catch(() => undefined);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found");
  }
  return tab;
}

async function ensureContentRecorder(tabId: number): Promise<void> {
  if (await contentRecorderResponds(tabId)) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/recorder.js"]
  });

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await contentRecorderResponds(tabId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Recorder content script did not initialize in the active tab");
}

async function contentRecorderResponds(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GET_STATUS" } satisfies ExtensionMessage);
    return true;
  } catch {
    return false;
  }
}
