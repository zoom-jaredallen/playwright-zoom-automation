/**
 * Background service worker that aggregates recorded actions from the content
 * script, manages recording state, and generates the final workflow JSON.
 */
import type { ExtensionMessage, RecordedAction, RecordedWorkflow, WorkflowAssertion, WorkflowParameter, WorkflowTestEvent } from "../shared/types.js";

const DRAFT_STORAGE_KEY = "recorderDraftState";

interface DraftState {
  recording: boolean;
  paused: boolean;
  actions: RecordedAction[];
  recordingStartTime: number;
  recordingStartUrl: string;
  impersonationDetected: boolean;
  activeTabId?: number;
}

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let recordingStartTime = 0;
let recordingStartUrl = "";
let impersonationDetected = false;
let activeRecordingTabId: number | undefined;
let hydrationPromise: Promise<void> | undefined = hydrateDraftState();
let testRunning = false;
let testCurrentActionId: string | undefined;
let testEvents: WorkflowTestEvent[] = [];

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!recording || activeRecordingTabId !== tabId) return;
  if (!tab.url?.includes("zoom.us")) return;
  void syncContentRecorder(tabId);
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ensureHydrated();

  switch (message.type) {
    case "START_RECORDING":
      return await startRecording(message);

    case "STOP_RECORDING":
      return await stopRecording(message);

    case "PAUSE_RECORDING":
      return await setPaused(true);

    case "RESUME_RECORDING":
      return await setPaused(false);

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
        if (sender.tab?.id !== undefined) {
          activeRecordingTabId = sender.tab.id;
        }
        updateBadge();
        await persistAndBroadcast();
      }
      return { ok: true };

    case "GET_STATUS":
      return { recording, paused, actionCount: actions.length };

    case "GET_ACTIONS":
      return { actions };

    case "BUILD_WORKFLOW":
      return { workflow: buildWorkflow() };

    case "DELETE_ACTION":
      actions = actions.filter((a) => a.id !== message.actionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true };

    case "UPDATE_ACTION":
      updateAction(message.actionId, {
        description: message.description,
        cssSelector: message.cssSelector,
        selectorNote: message.selectorNote,
        url: message.url,
        assertionType: message.assertionType,
        expected: message.expected,
        timeout: message.timeout,
        onFailure: message.onFailure,
        retryCount: message.retryCount,
        retryDelayMs: message.retryDelayMs,
        continueOnFailure: message.continueOnFailure,
        screenshotOnFailure: message.screenshotOnFailure,
        condition: message.condition,
        screenshotLabel: message.screenshotLabel,
        waitMs: message.waitMs
      });
      await persistAndBroadcast();
      return { ok: true };

    case "MOVE_ACTION":
      moveAction(message.actionId, message.direction);
      await persistAndBroadcast();
      return { ok: true };

    case "ADD_NAVIGATION_ACTION":
      addNavigationAction(message.url, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_ASSERTION_ACTION":
      addAssertionAction(message.assertionType, message.expected, message.timeout, message.onFailure, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_SCREENSHOT_ACTION":
      addScreenshotAction(message.label, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_WAIT_ACTION":
      addWaitAction(message.waitMs, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "CLEAR_ACTIONS":
      if (activeRecordingTabId !== undefined) {
        await chrome.tabs
          .sendMessage(activeRecordingTabId, { type: "STOP_RECORDING" } satisfies ExtensionMessage)
          .catch(() => undefined);
      }
      recording = false;
      actions = [];
      recordingStartUrl = "";
      recordingStartTime = Date.now();
      paused = false;
      activeRecordingTabId = undefined;
      updateBadge();
      await chrome.storage.local.remove(["lastWorkflow", "lastActions"]);
      await clearDraftState();
      broadcastRecorderState();
      return { ok: true };

    case "UPDATE_PARAMETER":
      const action = actions.find((a) => a.id === message.actionId);
      if (action?.parameterHints?.[message.paramIndex]) {
        action.parameterHints[message.paramIndex].confirmed = message.confirmed;
      }
      await persistAndBroadcast();
      return { ok: true };

    case "RUN_TEST_WORKFLOW":
      void runTestWorkflow();
      return { ok: true };

    case "GET_TEST_WORKFLOW_STATE":
      return { running: testRunning, currentActionId: testCurrentActionId, events: testEvents };

    case "TEST_SELECTOR": {
      const tab = await getActiveTab();
      if (!tab.id) return { error: "No active tab found" };
      await ensureContentRecorder(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }

    default:
      return { ok: false, error: "Unknown message type" };
  }
}

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
  activeRecordingTabId = tab.id;
  updateBadge();

  try {
    await ensureContentRecorder(tab.id);
    await chrome.tabs.sendMessage(tab.id, message);
    await persistAndBroadcast();
    return { ok: true };
  } catch (error) {
    recording = false;
    paused = false;
    activeRecordingTabId = undefined;
    updateBadge();
    await clearDraftState();
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
    activeRecordingTabId = undefined;
    updateBadge();
  }

  const workflow = buildWorkflow();
  await chrome.storage.local.set({ lastWorkflow: workflow, lastActions: actions });
  await clearDraftState();
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
    activeRecordingTabId = tab.id;
    await chrome.tabs
      .sendMessage(tab.id, { type: nextPaused ? "PAUSE_RECORDING" : "RESUME_RECORDING" } satisfies ExtensionMessage)
      .catch(() => undefined);
  }
  updateBadge();
  await persistAndBroadcast();
  return { ok: true };
}

function updateAction(
  actionId: string,
  update: {
    description?: string;
    cssSelector?: string;
    selectorNote?: string;
    url?: string;
    assertionType?: RecordedAction["assertionType"];
    expected?: string;
    timeout?: number;
    onFailure?: RecordedAction["onFailure"];
    retryCount?: number;
    retryDelayMs?: number;
    continueOnFailure?: boolean;
    screenshotOnFailure?: boolean;
    condition?: RecordedAction["condition"];
    screenshotLabel?: string;
    waitMs?: number;
  }
): void {
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
  if (update.url !== undefined && action.type === "navigate") {
    const url = normalizeNavigationUrl(update.url);
    action.url = url;
    action.pageUrl = url;
    if (!recordingStartUrl || recordingStartUrl === action.pageUrl) {
      recordingStartUrl = url;
    }
  }
  if (update.assertionType !== undefined && action.type === "assert") {
    action.assertionType = update.assertionType;
  }
  if (update.expected !== undefined && action.type === "assert") {
    action.expected = update.expected.trim();
  }
  if (update.timeout !== undefined && action.type === "assert") {
    action.timeout = Math.min(Math.max(Math.round(update.timeout), 500), 60_000);
  }
  if (update.onFailure !== undefined && action.type === "assert") {
    action.onFailure = update.onFailure;
  }
  if (update.retryCount !== undefined) {
    action.retryCount = Math.min(Math.max(Math.round(update.retryCount), 0), 10);
  }
  if (update.retryDelayMs !== undefined) {
    action.retryDelayMs = Math.min(Math.max(Math.round(update.retryDelayMs), 0), 60_000);
  }
  if (update.continueOnFailure !== undefined) {
    action.continueOnFailure = update.continueOnFailure;
  }
  if (update.screenshotOnFailure !== undefined) {
    action.screenshotOnFailure = update.screenshotOnFailure;
  }
  if (update.condition !== undefined) {
    action.condition = update.condition.type === "none" ? undefined : update.condition;
  }
  if (update.screenshotLabel !== undefined && action.type === "screenshot") {
    action.screenshotLabel = update.screenshotLabel.trim() || "evidence";
  }
  if (update.waitMs !== undefined && action.type === "wait") {
    action.waitMs = Math.min(Math.max(Math.round(update.waitMs), 250), 60_000);
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

function addNavigationAction(rawUrl: string, insertAfterActionId?: string | null): void {
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

  insertAction(action, insertAfterActionId);
  if (!recordingStartUrl) {
    recordingStartUrl = url;
  }
}

function addAssertionAction(
  assertionType: RecordedAction["assertionType"],
  expected: string,
  timeout = 10_000,
  onFailure: RecordedAction["onFailure"] = "screenshot",
  insertAfterActionId?: string | null
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

  insertAction(action, insertAfterActionId);
}

function addScreenshotAction(label?: string, insertAfterActionId?: string | null): void {
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

  insertAction(action, insertAfterActionId);
}

function addWaitAction(waitMs: number, insertAfterActionId?: string | null): void {
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

  insertAction(action, insertAfterActionId);
}

function insertAction(action: RecordedAction, insertAfterActionId?: string | null): void {
  if (insertAfterActionId === null) {
    actions.unshift(action);
    return;
  }

  if (insertAfterActionId) {
    const index = actions.findIndex((candidate) => candidate.id === insertAfterActionId);
    if (index >= 0) {
      actions.splice(index + 1, 0, action);
      return;
    }
  }

  actions.push(action);
}

function lastInsertedActionId(insertAfterActionId?: string | null): string | undefined {
  if (insertAfterActionId === null) return actions[0]?.id;
  if (insertAfterActionId) {
    const index = actions.findIndex((candidate) => candidate.id === insertAfterActionId);
    return index >= 0 ? actions[index + 1]?.id : actions.at(-1)?.id;
  }
  return actions.at(-1)?.id;
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

async function runTestWorkflow(): Promise<void> {
  await ensureHydrated();
  if (testRunning) return;
  if (recording) {
    pushTestEvent("error", "Stop recording before running a test.");
    return;
  }

  const testActions = actions.length > 0 ? actions : await loadLastRecordedActions();
  if (testActions.length === 0) {
    pushTestEvent("error", "No workflow steps are available to test.");
    return;
  }

  const tab = await getActiveTab().catch(() => undefined);
  if (!tab?.id) {
    pushTestEvent("error", "No active tab is available for testing.");
    return;
  }

  testRunning = true;
  testCurrentActionId = undefined;
  testEvents = [];
  pushTestEvent("info", `Starting browser test with ${testActions.length} step(s).`);

  try {
    for (const action of testActions) {
      testCurrentActionId = action.id;
      broadcastTestState();
      pushTestEvent("info", `Step: ${action.description ?? action.type}`, action.id);

      if (action.type === "navigate") {
        const url = normalizeNavigationUrl(action.url ?? action.pageUrl ?? "/");
        await navigateTestTab(tab.id, url);
      } else if (action.type === "screenshot") {
        await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        pushTestEvent("success", `Screenshot captured: ${action.screenshotLabel ?? "evidence"}`, action.id);
      } else {
        await ensureContentRecorder(tab.id);
        const result = await executeTestActionWithPolicy(tab, action);
        if (result.skipped) {
          pushTestEvent("info", result.message ?? `Skipped: ${action.description ?? action.type}`, action.id);
          if (action.condition?.type === "addressAlreadyExistsSkipAccount") {
            pushTestEvent("success", "Account-level skip condition met; test stopped.", action.id);
            break;
          }
        }
      }
      pushTestEvent("success", `Passed: ${action.description ?? action.type}`, action.id);
    }
    pushTestEvent("success", "Browser test completed.");
  } catch (error) {
    pushTestEvent("error", error instanceof Error ? error.message : String(error), testCurrentActionId);
  } finally {
    testRunning = false;
    testCurrentActionId = undefined;
    broadcastTestState();
  }
}

async function executeTestActionWithPolicy(tab: chrome.tabs.Tab, action: RecordedAction): Promise<{ skipped?: boolean; message?: string }> {
  const attempts = Math.max(1, (action.retryCount ?? (action.onFailure === "retry" ? 1 : 0)) + 1);
  const retryDelayMs = action.retryDelayMs ?? 1_000;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await chrome.tabs.sendMessage(tab.id!, { type: "EXECUTE_TEST_ACTION", action } satisfies ExtensionMessage);
    if (result?.ok) {
      return { skipped: Boolean(result.skipped), message: result.message };
    }

    lastError = result?.error ?? `Step failed: ${action.description ?? action.type}`;
    if (attempt < attempts) {
      pushTestEvent("info", `Retry ${attempt}/${attempts - 1}: ${lastError}`, action.id);
      await sleep(retryDelayMs);
    }
  }

  if (action.screenshotOnFailure || action.onFailure === "screenshot") {
    await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
    pushTestEvent("info", "Failure screenshot captured.", action.id);
  }
  if (action.continueOnFailure || action.onFailure === "skip") {
    pushTestEvent("error", `Continuing after failure: ${lastError}`, action.id);
    return { skipped: true, message: lastError };
  }
  throw new Error(lastError ?? `Step failed: ${action.description ?? action.type}`);
}

async function loadLastRecordedActions(): Promise<RecordedAction[]> {
  const stored = await chrome.storage.local.get("lastActions");
  return Array.isArray(stored.lastActions) ? stored.lastActions as RecordedAction[] : [];
}

async function navigateTestTab(tabId: number, url: string): Promise<void> {
  const currentTab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (currentTab?.url === url) {
    await ensureContentRecorder(tabId);
    return;
  }
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
  await ensureContentRecorder(tabId);
}

async function waitForTabComplete(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30_000);
  });
}

function pushTestEvent(level: WorkflowTestEvent["level"], message: string, actionId?: string): void {
  testEvents.push({ timestamp: Date.now(), level, message, actionId });
  broadcastTestState();
}

function broadcastTestState(): void {
  chrome.runtime.sendMessage({
    type: "TEST_WORKFLOW_STATE_UPDATED",
    running: testRunning,
    currentActionId: testCurrentActionId,
    events: testEvents
  } satisfies ExtensionMessage).catch(() => undefined);
}

async function syncContentRecorder(tabId: number): Promise<void> {
  await ensureHydrated();
  if (!recording || activeRecordingTabId !== tabId) return;

  try {
    await ensureContentRecorder(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "START_RECORDING" } satisfies ExtensionMessage);
    if (paused) {
      await chrome.tabs.sendMessage(tabId, { type: "PAUSE_RECORDING" } satisfies ExtensionMessage).catch(() => undefined);
    }
  } catch {
    // The user may have navigated away from a scriptable Zoom page; keep the draft in background storage.
  }
}

async function ensureHydrated(): Promise<void> {
  hydrationPromise ??= hydrateDraftState();
  await hydrationPromise;
}

async function hydrateDraftState(): Promise<void> {
  const stored = await getDraftStorage().get(DRAFT_STORAGE_KEY);
  const draft = stored[DRAFT_STORAGE_KEY] as DraftState | undefined;
  if (!draft) return;

  recording = draft.recording;
  paused = draft.paused;
  actions = draft.actions ?? [];
  recordingStartTime = draft.recordingStartTime;
  recordingStartUrl = draft.recordingStartUrl;
  impersonationDetected = draft.impersonationDetected;
  activeRecordingTabId = draft.activeTabId;
  updateBadge();
}

async function persistAndBroadcast(): Promise<void> {
  await persistDraftState();
  broadcastRecorderState();
}

async function persistDraftState(): Promise<void> {
  if (!recording && actions.length === 0) {
    await clearDraftState();
    return;
  }

  await getDraftStorage().set({
    [DRAFT_STORAGE_KEY]: {
      recording,
      paused,
      actions,
      recordingStartTime,
      recordingStartUrl,
      impersonationDetected,
      activeTabId: activeRecordingTabId
    } satisfies DraftState
  });
}

async function clearDraftState(): Promise<void> {
  await getDraftStorage().remove(DRAFT_STORAGE_KEY);
}

function getDraftStorage(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

// ─── Workflow Builder ────────────────────────────────────────────────────────

function buildWorkflow(): RecordedWorkflow {
  const parameters = extractParameters(actions);
  const assertions = generateAssertions(actions);
  const startUrl = extractRelativeStartUrl(recordingStartUrl);

  const workflowActions = actions.map((action) => ({
    ...action,
    // Replace confirmed parameter values with template placeholders
    value: replaceWithPlaceholders(action)
  }));

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
    actions: workflowActions,
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
    },
    quality: calculateQualityReport(workflowActions, assertions)
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

function calculateQualityReport(workflowActions: RecordedAction[], assertions: WorkflowAssertion[]): RecordedWorkflow["quality"] {
  const actionable = workflowActions.filter((action) => !["navigate", "wait", "screenshot", "dismiss"].includes(action.type));
  const stableSelectors = actionable.filter((action) => action.selectors.role?.name || action.selectors.label || action.selectors.testId).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = workflowActions.filter((action) => action.type === "click" && /save|submit|add|continue|confirm/i.test(action.selectors.role?.name ?? action.selectors.text ?? ""));
  const assertionCoverage = submitActions.length === 0 ? 100 : Math.round((Math.min(assertions.length, submitActions.length) / submitActions.length) * 100);
  const evidenceCount = workflowActions.filter((action) => action.type === "screenshot" || action.screenshotOnFailure || action.onFailure === "screenshot").length;
  const evidenceCoverage = workflowActions.length === 0 ? 100 : Math.round((evidenceCount / workflowActions.length) * 100);
  const riskySteps = workflowActions.filter((action) => action.type === "click" && !action.selectors.role?.name && !action.selectors.testId).length;
  const hardcodedValues = workflowActions.filter((action) => (action.value || action.expected || "").length > 0 && !(action.value || action.expected || "").includes("{{")).length;
  const unsupportedBrowserPreflightSteps = workflowActions.filter((action) => action.type === "upload").length;
  const penalties = riskySteps * 7 + hardcodedValues * 3 + unsupportedBrowserPreflightSteps * 8;
  const score = Math.max(0, Math.min(100, Math.round((selectorStability * 0.35) + (assertionCoverage * 0.3) + (evidenceCoverage * 0.2) + 15 - penalties)));
  const warnings = [
    selectorStability < 70 ? "Several steps rely on weak selectors." : undefined,
    assertionCoverage < 80 ? "Add validations after important submit/save actions." : undefined,
    evidenceCoverage < 25 ? "Add screenshots for evidence and failure diagnosis." : undefined,
    unsupportedBrowserPreflightSteps > 0 ? "Upload steps cannot be tested by the extension preflight runner." : undefined,
    hardcodedValues > 0 ? "Review hardcoded values and parameterize tenant-specific inputs." : undefined
  ].filter(Boolean) as string[];

  return { score, selectorStability, assertionCoverage, evidenceCoverage, riskySteps, hardcodedValues, unsupportedBrowserPreflightSteps, warnings };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
