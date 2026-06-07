/**
 * Background service worker that aggregates recorded actions from the content
 * script, manages recording state, and generates the final workflow JSON.
 */
import type { ExtensionMessage, RecordedAction, RecordedWorkflow, WorkflowTestEvent } from "../shared/types.js";
import { createStepTestPlan } from "../shared/testPlan.js";
import { firstRecordableNavigationUrl, shouldAcceptRecordedAction, shouldRecordNavigationUrl } from "../shared/navigationPolicy.js";
import {
  applyStepUpdate,
  buildWorkflow as buildWorkflowCore,
  deleteStep,
  insertStep,
  makeAssertionAction,
  makeClickAction,
  makeDialogAction,
  makeDismissAction,
  makeFillAction,
  makeNavigationAction,
  makePressAction,
  makeScreenshotAction,
  makeSelectAction,
  makeWaitAction,
  moveStep,
  normalizeNavigationUrl,
  setParameterConfirmed,
  type StepUpdate
} from "@zoom-automation/workflow-core";

const DRAFT_STORAGE_KEY = "recorderDraftState";

type TestTab = chrome.tabs.Tab & { id: number };

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
  if (!tab.url?.includes("zoom.us") || !shouldRecordNavigationUrl(tab.url)) return;
  void syncContentRecorder(tabId);
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ensureHydrated();

  if (message.type === "SET_EXTENSION_ENABLED") {
    await chrome.storage.local.set({ extensionEnabled: message.enabled });
    if (!message.enabled) {
      await disableExtensionRuntime();
    }
    return { ok: true };
  }

  if (!(await getExtensionEnabled()) && requiresEnabled(message.type)) {
    return { ok: false, error: "Extension is disabled." };
  }

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
        const accepted = !message.action.id.startsWith("meta_") && shouldAcceptRecordedAction(message.action, { frameId: sender.frameId });
        if (accepted) {
          actions.push(await withVisibleTabThumbnail(message.action, sender.tab));
        }
        const startUrlCandidate = message.action.type === "navigate" ? message.action.url : message.action.pageUrl;
        if (accepted && !recordingStartUrl && startUrlCandidate && shouldRecordNavigationUrl(startUrlCandidate, { frameId: sender.frameId })) {
          recordingStartUrl = startUrlCandidate;
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
      return { actions: await availableActions({ restore: true }), workflow: await loadLastWorkflow() };

    case "BUILD_WORKFLOW":
      await availableActions({ restore: true });
      return { workflow: buildWorkflow() };

    case "DELETE_ACTION":
      actions = deleteStep(actions, message.actionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true };

    case "UPDATE_ACTION":
      updateAction(message.actionId, {
        description: message.description,
        selectors: message.selectors,
        selectorCandidates: message.selectorCandidates,
        selectedCandidateId: message.selectedCandidateId,
        cssSelector: message.cssSelector,
        selectorNote: message.selectorNote,
        frameSelector: message.frameSelector,
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
        waitMs: message.waitMs,
        value: message.value,
        networkWaitUrl: message.networkWaitUrl,
        waitForUrl: message.waitForUrl,
        key: message.key,
        dialogAction: message.dialogAction,
        dialogPromptText: message.dialogPromptText,
        elementScreenshot: message.elementScreenshot,
        capture: message.capture,
        selectorDiagnostics: message.selectorDiagnostics,
        repairSuggestions: message.repairSuggestions
      });
      await persistAndBroadcast();
      return { ok: true };

    case "ADD_DIALOG_ACTION":
      addDialogAction(message.dialogAction, message.promptText, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

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

    case "ADD_CLICK_ACTION":
      addClickAction(message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_FILL_ACTION":
      addFillAction(message.value, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_SELECT_ACTION":
      addSelectAction(message.value, message.insertAfterActionId);
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(message.insertAfterActionId) };

    case "ADD_PRESS_ACTION":
      addPressAction(message.key, message.insertAfterActionId);
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

    case "ADD_DISMISS_ACTION":
      addDismissAction(message.insertAfterActionId);
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

    case "IMPORT_WORKFLOW":
      return await importWorkflow(message.workflow);

    case "UPDATE_PARAMETER":
      actions = setParameterConfirmed(actions, message.actionId, message.paramIndex, message.confirmed);
      await persistAndBroadcast();
      return { ok: true };

    case "RUN_TEST_WORKFLOW":
      return await startTestWorkflow({ mode: "full" });

    case "RUN_TEST_WORKFLOW_FROM":
      return await startTestWorkflow({ mode: "from", actionId: message.actionId });

    case "RUN_TEST_ACTION":
      return await startTestAction(message.action);

    case "GET_TEST_WORKFLOW_STATE":
      return { running: testRunning, currentActionId: testCurrentActionId, events: testEvents };

    case "TEST_SELECTOR": {
      const tab = await getActiveTab();
      if (!tab.id) return { error: "No active tab found" };
      await ensureContentRecorder(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }

    case "HIGHLIGHT_ACTION_TARGET": {
      const tab = await getActiveTab();
      if (!tab.id) return { error: "No active tab found" };
      await ensureContentRecorder(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }

    case "PICK_SELECTOR": {
      const tab = await getActiveTab();
      if (!tab.id) return { error: "No active tab found" };
      await ensureContentRecorder(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }

    case "PICK_ANCHOR": {
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

async function disableExtensionRuntime(): Promise<void> {
  if (activeRecordingTabId !== undefined) {
    await chrome.tabs
      .sendMessage(activeRecordingTabId, { type: "STOP_RECORDING" } satisfies ExtensionMessage)
      .catch(() => undefined);
  }
  recording = false;
  paused = false;
  activeRecordingTabId = undefined;
  testRunning = false;
  testCurrentActionId = undefined;
  updateBadge();
  await persistAndBroadcast();
  broadcastTestState();
}

function updateAction(actionId: string, update: StepUpdate): void {
  const existing = actions.find((candidate) => candidate.id === actionId);
  if (!existing) return;
  const previousPageUrl = existing.pageUrl;

  actions = actions.map((action) => (action.id === actionId ? applyStepUpdate(action, update) : action));

  // Preserve the recording start URL when the first navigation's URL is edited.
  if (update.url !== undefined && existing.type === "navigate") {
    const updated = actions.find((candidate) => candidate.id === actionId);
    if (updated?.url && (!recordingStartUrl || recordingStartUrl === previousPageUrl)) {
      recordingStartUrl = updated.url;
    }
  }
}

async function withVisibleTabThumbnail(action: RecordedAction, tab: chrome.tabs.Tab | undefined): Promise<RecordedAction> {
  if (!action.capture || tab?.windowId === undefined) return action;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 35 });
    const width = Math.min(action.capture.viewport.width, 420);
    const height = Math.round(width * (action.capture.viewport.height / Math.max(action.capture.viewport.width, 1)));
    return {
      ...action,
      capture: {
        ...action.capture,
        thumbnail: { dataUrl, width, height }
      }
    };
  } catch {
    return action;
  }
}

function addDialogAction(
  dialogAction: NonNullable<RecordedAction["dialogAction"]>,
  promptText?: string,
  insertAfterActionId?: string | null
): void {
  actions = insertStep(actions, makeDialogAction(dialogAction, promptText, recordingStartUrl), insertAfterActionId);
}

function moveAction(actionId: string, direction: "up" | "down"): void {
  actions = moveStep(actions, actionId, direction);
}

function addNavigationAction(rawUrl: string, insertAfterActionId?: string | null): void {
  const action = makeNavigationAction(rawUrl);
  actions = insertStep(actions, action, insertAfterActionId);
  if (!recordingStartUrl && action.url) {
    recordingStartUrl = action.url;
  }
}

function addAssertionAction(
  assertionType: RecordedAction["assertionType"],
  expected: string,
  timeout = 10_000,
  onFailure: RecordedAction["onFailure"] = "screenshot",
  insertAfterActionId?: string | null
): void {
  actions = insertStep(
    actions,
    makeAssertionAction(assertionType, expected, recordingStartUrl, timeout, onFailure),
    insertAfterActionId
  );
}

function addClickAction(insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeClickAction(recordingStartUrl), insertAfterActionId);
}

function addFillAction(value?: string, insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeFillAction(value, recordingStartUrl), insertAfterActionId);
}

function addSelectAction(value?: string, insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeSelectAction(value, recordingStartUrl), insertAfterActionId);
}

function addPressAction(key?: string, insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makePressAction(key, recordingStartUrl), insertAfterActionId);
}

function addScreenshotAction(label?: string, insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeScreenshotAction(label, recordingStartUrl), insertAfterActionId);
}

function addWaitAction(waitMs: number, insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeWaitAction(waitMs, recordingStartUrl), insertAfterActionId);
}

function addDismissAction(insertAfterActionId?: string | null): void {
  actions = insertStep(actions, makeDismissAction(recordingStartUrl), insertAfterActionId);
}

function lastInsertedActionId(insertAfterActionId?: string | null): string | undefined {
  if (insertAfterActionId === null) return actions[0]?.id;
  if (insertAfterActionId) {
    const index = actions.findIndex((candidate) => candidate.id === insertAfterActionId);
    return index >= 0 ? actions[index + 1]?.id : actions.at(-1)?.id;
  }
  return actions.at(-1)?.id;
}

async function startTestWorkflow(planOptions: { mode: "full" | "from"; actionId?: string }): Promise<{ ok: boolean; error?: string }> {
  await ensureHydrated();
  if (testRunning) return { ok: true };
  if (recording) {
    pushTestEvent("error", "Stop recording before running a test.");
    return { ok: false, error: "Stop recording before running a test." };
  }

  const available = await availableActions({ restore: true });
  const testPlan = createStepTestPlan(available, planOptions);
  const testActions = testPlan.actions;
  if (testActions.length === 0) {
    pushTestEvent("error", "No workflow steps are available to test.");
    return { ok: false, error: "No workflow steps are available to test." };
  }

  const tab = await getActiveTab().catch(() => undefined);
  if (!tab?.id) {
    pushTestEvent("error", "No active tab is available for testing.");
    return { ok: false, error: "No active tab is available for testing." };
  }

  testRunning = true;
  testCurrentActionId = undefined;
  testEvents = [];
  pushTestEvent("info", `Starting ${testPlan.mode} browser test with ${testActions.length} step(s).`);
  void runTestWorkflow(testActions, tab as TestTab);
  return { ok: true };
}

async function startTestAction(action: RecordedAction): Promise<{ ok: boolean; error?: string }> {
  await ensureHydrated();
  if (testRunning) return { ok: false, error: "A test is already running." };
  if (recording) {
    pushTestEvent("error", "Stop recording before testing a step.", action.id);
    return { ok: false, error: "Stop recording before testing a step." };
  }

  const tab = await getActiveTab().catch(() => undefined);
  if (!tab?.id) {
    pushTestEvent("error", "No active tab is available for testing.", action.id);
    return { ok: false, error: "No active tab is available for testing." };
  }

  testRunning = true;
  testCurrentActionId = action.id;
  testEvents = [];
  broadcastTestState();
  pushTestEvent("info", `Testing step: ${action.description ?? action.type}`, action.id);

  try {
    await runSingleTestAction(action, tab as TestTab);
    pushTestEvent("success", `Passed: ${action.description ?? action.type}`, action.id);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushTestEvent("error", message, action.id);
    return { ok: false, error: message };
  } finally {
    testRunning = false;
    testCurrentActionId = undefined;
    broadcastTestState();
  }
}

async function runTestWorkflow(testActions: RecordedAction[], tab: TestTab): Promise<void> {
  try {
    for (const action of testActions) {
      testCurrentActionId = action.id;
      broadcastTestState();
      pushTestEvent("info", `Step: ${action.description ?? action.type}`, action.id);

      const result = await runSingleTestAction(action, tab);
      if (result.stopWorkflow) {
        break;
      }
      if (result.skipped && action.condition?.type === "addressAlreadyExistsSkipAccount") {
        pushTestEvent("success", "Account-level skip condition met; test stopped.", action.id);
        break;
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

async function runSingleTestAction(
  action: RecordedAction,
  tab: TestTab
): Promise<{ skipped?: boolean; stopWorkflow?: boolean }> {
  if (action.type === "navigate") {
    const result = await evaluatePreflightNavigation(tab.id, action);
    pushTestEvent("info", result.message, action.id);
    if (result.navigated && result.targetUrl) {
      await waitForPreflightNavigation(tab.id, result.targetUrl);
      await ensureContentRecorder(tab.id);
    }
    await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
    return { skipped: !result.navigated };
  }

  if (action.type === "screenshot") {
    await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
    await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    pushTestEvent("success", `Screenshot captured: ${action.screenshotLabel ?? "evidence"}`, action.id);
    return {};
  }

  await ensureContentRecorder(tab.id);
  const result = await executeTestActionWithPolicy(tab, action);
  if (result.skipped) {
    pushTestEvent("info", result.message ?? `Skipped: ${action.description ?? action.type}`, action.id);
    return { skipped: true, stopWorkflow: action.condition?.type === "addressAlreadyExistsSkipAccount" };
  }
  return {};
}

async function executeTestActionWithPolicy(tab: chrome.tabs.Tab, action: RecordedAction): Promise<{ skipped?: boolean; message?: string }> {
  // Honor both an explicit retryCount and onFailure:"retry" (whichever asks for more).
  const retryBudget = Math.max(action.retryCount ?? 0, action.onFailure === "retry" ? 1 : 0);
  const attempts = retryBudget + 1;
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

async function waitForTestPageReady(tabId: number, timeout: number): Promise<void> {
  await ensureContentRecorder(tabId);
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "WAIT_FOR_PAGE_READY",
    timeout
  } satisfies ExtensionMessage);
  if (!result?.ok) {
    throw new Error(result?.error ?? "Page did not become ready before the step timeout.");
  }
}

async function loadLastRecordedActions(): Promise<RecordedAction[]> {
  const stored = await chrome.storage.local.get("lastActions");
  return Array.isArray(stored.lastActions) ? stored.lastActions as RecordedAction[] : [];
}

async function loadLastWorkflow(): Promise<RecordedWorkflow | undefined> {
  const stored = await chrome.storage.local.get("lastWorkflow");
  return isRecordedWorkflow(stored.lastWorkflow) ? stored.lastWorkflow : undefined;
}

function isRecordedWorkflow(value: unknown): value is RecordedWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecordedWorkflow>;
  return candidate.version === 1
    && Boolean(candidate.meta && typeof candidate.meta === "object")
    && Array.isArray(candidate.actions);
}

async function availableActions(options: { restore: boolean }): Promise<RecordedAction[]> {
  if (actions.length > 0) {
    return actions;
  }

  const storedActions = await loadLastRecordedActions();
  if (options.restore && storedActions.length > 0) {
    actions = storedActions;
    broadcastRecorderState();
  }
  return storedActions;
}

async function evaluatePreflightNavigation(
  tabId: number,
  action: RecordedAction
): Promise<{ message: string; navigated: boolean; targetUrl?: string }> {
  const targetUrl = normalizeNavigationUrl(action.url ?? action.pageUrl ?? "/");
  const target = parseUrl(targetUrl);
  if (!target || !isZoomUrl(target)) {
    throw new Error("Navigation preflight only supports Zoom URLs to avoid leaving the impersonated session context.");
  }

  const currentTab = await chrome.tabs.get(tabId).catch(() => undefined);
  const currentUrl = currentTab?.url ?? "";
  const current = parseUrl(currentUrl);
  if (!current || !isZoomUrl(current)) {
    throw new Error("Open a Zoom tab in the impersonated account before running preflight navigation.");
  }

  const expectedFragment = action.waitForUrl ?? safeNavigationFragment(targetUrl);

  if (expectedFragment && currentUrl.includes(expectedFragment)) {
    return { message: "Navigation step already matches the current page; no tab navigation needed.", navigated: false };
  }

  await chrome.tabs.update(tabId, { url: targetUrl });
  return {
    message: `Navigating active Zoom tab to ${target.pathname}${target.hash || ""}.`,
    navigated: true,
    targetUrl
  };
}

function safeNavigationFragment(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hash || parsed.pathname || undefined;
  } catch {
    return undefined;
  }
}

async function waitForPreflightNavigation(tabId: number, targetUrl: string): Promise<void> {
  const expectedFragment = safeNavigationFragment(targetUrl);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const url = tab?.url ?? "";
    if (expectedFragment && url.includes(expectedFragment) && tab?.status === "complete") {
      return;
    }
    if (!expectedFragment && tab?.status === "complete") {
      return;
    }
    await sleep(250);
  }

  throw new Error("Navigation did not finish before the preflight timeout.");
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isZoomUrl(url: URL): boolean {
  return url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us");
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
  recordingStartUrl = shouldRecordNavigationUrl(draft.recordingStartUrl)
    ? draft.recordingStartUrl
    : firstRecordableNavigationUrl(actions) ?? "";
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

async function importWorkflow(workflow: RecordedWorkflow): Promise<{ ok: boolean; error?: string }> {
  const validation = validateImportWorkflow(workflow);
  if (validation) {
    return { ok: false, error: validation };
  }

  if (activeRecordingTabId !== undefined) {
    await chrome.tabs
      .sendMessage(activeRecordingTabId, { type: "STOP_RECORDING" } satisfies ExtensionMessage)
      .catch(() => undefined);
  }

  recording = false;
  paused = false;
  activeRecordingTabId = undefined;
  impersonationDetected = workflow.config?.requiresImpersonation !== false;
  recordingStartTime = parseRecordedAt(workflow.meta.recordedAt) ?? Date.now();
  actions = workflow.actions.map(normalizeImportedAction).filter((action) => shouldAcceptRecordedAction(action));
  recordingStartUrl = shouldRecordNavigationUrl(workflow.meta.recordedOnUrl)
    ? workflow.meta.recordedOnUrl
    : firstRecordableNavigationUrl(actions) ?? normalizeNavigationUrl(workflow.config?.startUrl ?? "/");
  updateBadge();
  await chrome.storage.local.set({ lastWorkflow: workflow, lastActions: actions });
  await persistAndBroadcast();
  return { ok: true };
}

function validateImportWorkflow(workflow: RecordedWorkflow): string | undefined {
  if (!workflow || typeof workflow !== "object") return "Imported file is not a workflow JSON object.";
  if (workflow.version !== 1) return "Only recorded workflow version 1 is supported.";
  if (!Array.isArray(workflow.actions)) return "Imported workflow is missing an actions array.";
  if (workflow.actions.length === 0) return "Imported workflow does not contain any steps.";
  const invalidIndex = workflow.actions.findIndex((action) => !action?.type || !action.id);
  if (invalidIndex >= 0) return `Imported workflow has an invalid step at position ${invalidIndex + 1}.`;
  return undefined;
}

function normalizeImportedAction(action: RecordedAction): RecordedAction {
  return {
    ...action,
    timestamp: Number.isFinite(action.timestamp) ? action.timestamp : Date.now(),
    selectors: action.selectors ?? {},
    pageUrl: action.pageUrl ?? action.url ?? recordingStartUrl,
    pageTitle: action.pageTitle ?? "Imported workflow step"
  };
}

function parseRecordedAt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function buildWorkflow(): RecordedWorkflow {
  return buildWorkflowCore({
    actions,
    recordingStartUrl,
    recordingStartTime,
    impersonationDetected
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExtensionEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get("extensionEnabled");
  return stored.extensionEnabled !== false;
}

function requiresEnabled(type: ExtensionMessage["type"]): boolean {
  return [
    "START_RECORDING",
    "PAUSE_RECORDING",
    "RESUME_RECORDING",
    "ACTION_RECORDED",
    "RUN_TEST_WORKFLOW",
    "RUN_TEST_ACTION",
    "WAIT_FOR_PAGE_READY",
    "EXECUTE_TEST_ACTION",
    "TEST_SELECTOR",
    "HIGHLIGHT_ACTION_TARGET",
    "PICK_SELECTOR",
    "PICK_ANCHOR"
  ].includes(type);
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
