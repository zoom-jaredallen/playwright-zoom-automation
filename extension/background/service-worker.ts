import type { ExtensionMessage, RecordedAction, RecordedWorkflow } from "../shared/types.js";
import { firstRecordableNavigationUrl, shouldAcceptRecordedAction, shouldRecordNavigationUrl } from "../shared/navigationPolicy.js";
import { insertRecordedAction, prepareRecordedActionsForWorkflow } from "../shared/recordedActionPolicy.js";
import { ensureContentRecorder, getActiveTab } from "./chromeTabUtils.js";
import { normalizeImportedAction, parseRecordedAt, validateImportWorkflow } from "./workflowImport.js";
import { executeRecorderDebugCommand, type RecorderDebugRuntime } from "./debugCommandExecutor.js";
import { WorkflowTestRunner } from "./workflowTestRunner.js";
import { withVisibleTabThumbnail } from "./captureService.js";
import { requiresEnabled } from "./messagePolicy.js";
import { broadcastRecorderState as broadcastStateMessage, updateRecorderBadge } from "./recorderBadge.js";
import {
  insertAssertionAction,
  insertClickAction,
  insertDialogAction,
  insertDismissAction,
  insertFillAction,
  insertNavigationAction,
  insertPressAction,
  insertScreenshotAction,
  insertSelectAction,
  insertWaitAction,
  lastInsertedActionId,
  moveRecordedAction,
  updateRecordedAction,
  type ActionEditState
} from "./manualActionEditor.js";
import { clearDraftState, loadDraftState, loadLastRecordedActions, loadLastWorkflow, persistLastWorkflow as persistWorkflowToStorage, saveDraftState, type DraftState } from "./recordingStorage.js";
import { fetchNextRecorderDebugCommand, postRecorderDebugCommandResult, postRecorderDebugSnapshot } from "../shared/debugBridge.js";
import { buildWorkflow as buildWorkflowCore, deleteStep, normalizeNavigationUrl, setParameterConfirmed, type StepUpdate } from "@zoom-automation/workflow-core";

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let recordingStartTime = 0;
let recordingStartUrl = "";
let impersonationDetected = false;
let activeRecordingTabId: number | undefined;
let hydrationPromise: Promise<void> | undefined = hydrateDraftState();
let debugCommandPollRunning = false;
let reloadExtensionAfterCommand = false;
const testRunner = new WorkflowTestRunner({
  ensureHydrated,
  isRecording: () => recording,
  availableActions,
  onStateChanged: () => {
    void publishRecorderDebugSnapshot();
  }
});

startRecorderDebugCommandPolling();

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
          actions = insertRecordedAction(actions, await withVisibleTabThumbnail(message.action, sender.tab));
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
      applyActionEdit(insertDialogAction(currentActionEditState(), message.dialogAction, message.promptText, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "MOVE_ACTION":
      applyActionEdit(moveRecordedAction(currentActionEditState(), message.actionId, message.direction));
      await persistAndBroadcast();
      return { ok: true };

    case "ADD_NAVIGATION_ACTION":
      applyActionEdit(insertNavigationAction(currentActionEditState(), message.url, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_ASSERTION_ACTION":
      applyActionEdit(insertAssertionAction(currentActionEditState(), message.assertionType, message.expected, message.timeout, message.onFailure, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_CLICK_ACTION":
      applyActionEdit(insertClickAction(currentActionEditState(), message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_FILL_ACTION":
      applyActionEdit(insertFillAction(currentActionEditState(), message.value, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_SELECT_ACTION":
      applyActionEdit(insertSelectAction(currentActionEditState(), message.value, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_PRESS_ACTION":
      applyActionEdit(insertPressAction(currentActionEditState(), message.key, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_SCREENSHOT_ACTION":
      applyActionEdit(insertScreenshotAction(currentActionEditState(), message.label, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_WAIT_ACTION":
      applyActionEdit(insertWaitAction(currentActionEditState(), message.waitMs, message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "ADD_DISMISS_ACTION":
      applyActionEdit(insertDismissAction(currentActionEditState(), message.insertAfterActionId));
      updateBadge();
      await persistAndBroadcast();
      return { ok: true, actionId: lastInsertedActionId(actions, message.insertAfterActionId) };

    case "CLEAR_ACTIONS":
      await clearRecordedActions();
      return { ok: true };

    case "IMPORT_WORKFLOW":
      return await importWorkflow(message.workflow);

    case "UPDATE_PARAMETER":
      actions = setParameterConfirmed(actions, message.actionId, message.paramIndex, message.confirmed);
      await persistAndBroadcast();
      return { ok: true };

    case "RUN_TEST_WORKFLOW":
      return await testRunner.startWorkflow({ mode: "full" });

    case "RUN_TEST_WORKFLOW_FROM":
      return await testRunner.startWorkflow({ mode: "from", actionId: message.actionId });

    case "RUN_TEST_ACTION":
      return await testRunner.startAction(message.action);

    case "GET_TEST_WORKFLOW_STATE":
      return testRunner.currentState();

    case "TEST_SELECTOR":
    case "HIGHLIGHT_ACTION_TARGET":
    case "PICK_SELECTOR":
    case "PICK_ANCHOR":
      return await forwardToActiveTab(message);

    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function forwardToActiveTab(message: ExtensionMessage): Promise<unknown> {
  const tab = await getActiveTab();
  if (!tab.id) return { error: "No active tab found" };
  await ensureContentRecorder(tab.id);
  return await chrome.tabs.sendMessage(tab.id, message);
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
  actions = workflow.actions;
  await persistLastWorkflow(workflow, actions);
  await clearDraftState();
  broadcastRecorderState();
  void publishRecorderDebugSnapshot();
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
  testRunner.stop();
  updateBadge();
  await persistAndBroadcast();
}

function updateAction(actionId: string, update: StepUpdate): void {
  applyActionEdit(updateRecordedAction(currentActionEditState(), actionId, update));
}

function currentActionEditState(): ActionEditState {
  return { actions, recordingStartUrl };
}

function applyActionEdit(next: ActionEditState): void {
  actions = next.actions;
  recordingStartUrl = next.recordingStartUrl;
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
  const draft = await loadDraftState();
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
  void publishRecorderDebugSnapshot();
}

async function persistDraftState(): Promise<void> {
  if (!recording && actions.length === 0) {
    await clearDraftState();
    return;
  }

  await saveDraftState({
    recording,
    paused,
    actions,
    recordingStartTime,
    recordingStartUrl,
    impersonationDetected,
    activeTabId: activeRecordingTabId
  } satisfies DraftState, (level, message) => testRunner.pushEvent(level, message));
}

async function persistLastWorkflow(workflow: RecordedWorkflow, workflowActions: RecordedAction[]): Promise<void> {
  await persistWorkflowToStorage(workflow, workflowActions, (level, message) => testRunner.pushEvent(level, message));
}

function startRecorderDebugCommandPolling(): void {
  setInterval(() => {
    void pollRecorderDebugCommand();
  }, 2_000);
  void pollRecorderDebugCommand();
}

async function pollRecorderDebugCommand(): Promise<void> {
  if (debugCommandPollRunning || !(await getExtensionEnabled())) return;
  debugCommandPollRunning = true;
  try {
    const command = await fetchNextRecorderDebugCommand().catch(() => undefined);
    if (!command) return;
    const result = await executeRecorderDebugCommand(command, recorderDebugRuntime());
    await postRecorderDebugCommandResult(command.id, result).catch(() => undefined);
    void publishRecorderDebugSnapshot();
    if (command.type === "RELOAD_EXTENSION") {
      reloadExtensionAfterCommand = true;
    }
    if (reloadExtensionAfterCommand) {
      reloadExtensionAfterCommand = false;
      setTimeout(() => chrome.runtime.reload(), 250);
    }
  } finally {
    debugCommandPollRunning = false;
  }
}

function recorderDebugRuntime(): RecorderDebugRuntime {
  return {
    startRecording,
    stopRecording,
    availableActions,
    buildWorkflow,
    loadLastWorkflow,
    persistLastWorkflow,
    setActions(nextActions) {
      actions = nextActions;
    },
    importWorkflow,
    startTestWorkflow: (options) => testRunner.startWorkflow(options),
    waitForDebugTestCompletion: () => testRunner.waitForCompletion(),
    hasDebugTestError: () => testRunner.hasError(),
    currentTestState: () => testRunner.currentState(),
    getTestEvents() {
      return testRunner.getEvents();
    },
    startTestAction: (action) => testRunner.startAction(action),
    clearRecordedActions,
    currentRecorderDebugSessionId
  };
}
async function publishRecorderDebugSnapshot(): Promise<void> {
  const workflow = actions.length > 0 ? buildWorkflow() : await loadLastWorkflow();
  const preparedActions = actions.length > 0 ? prepareRecordedActionsForWorkflow(actions) : workflow?.actions ?? [];
  const tab = await getActiveTab().catch(() => undefined);
  await postRecorderDebugSnapshot({
    sessionId: currentRecorderDebugSessionId(workflow),
    timestamp: new Date().toISOString(),
    source: "extension",
    status: { recording, paused, actionCount: actions.length },
    rawActions: actions,
    preparedActions,
    workflow,
    quality: workflow?.quality,
    testState: testRunner.currentState(),
    page: tab?.url ? { url: tab.url, title: tab.title ?? "Chrome tab" } : undefined
  }).catch(() => undefined);
}

function currentRecorderDebugSessionId(workflow?: RecordedWorkflow): string {
  const recordedAt = workflow?.meta.recordedAt ? Date.parse(workflow.meta.recordedAt) : Number.NaN;
  const basis = recordingStartTime || (Number.isNaN(recordedAt) ? Date.now() : recordedAt);
  return `recorder-${new Date(basis).toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

async function clearRecordedActions(): Promise<void> {
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
  void publishRecorderDebugSnapshot();
}

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
  actions = workflow.actions.map((action) => normalizeImportedAction(action, recordingStartUrl)).filter((action) => shouldAcceptRecordedAction(action));
  recordingStartUrl = shouldRecordNavigationUrl(workflow.meta.recordedOnUrl)
    ? workflow.meta.recordedOnUrl
    : firstRecordableNavigationUrl(actions) ?? normalizeNavigationUrl(workflow.config?.startUrl ?? "/");
  updateBadge();
  await persistLastWorkflow({ ...workflow, actions }, actions);
  await persistAndBroadcast();
  return { ok: true };
}

function buildWorkflow(): RecordedWorkflow {
  return buildWorkflowCore({
    actions: prepareRecordedActionsForWorkflow(actions),
    recordingStartUrl,
    recordingStartTime,
    impersonationDetected
  });
}

async function getExtensionEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get("extensionEnabled");
  return stored.extensionEnabled !== false;
}

function updateBadge(): void {
  updateRecorderBadge({ recording, paused, actionCount: actions.length });
}

function broadcastRecorderState(): void {
  broadcastStateMessage({ recording, paused, actions });
}
