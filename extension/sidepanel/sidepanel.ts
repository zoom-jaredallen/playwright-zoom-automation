import { suggestParameterReplacements } from "../shared/authoringAssistants.js";
import type { ExtensionMessage, RecordedAction, RecordedWorkflow, AnchorPickResult, SelectorPickResult, SelectorTestResult, WorkflowTestEvent } from "../shared/types.js";
import {
  calculateQualityReport,
  collectAllParameters,
  isSubmitLikeClick,
  selectorConfidence,
} from "./qualityUtils.js";
import { renderInlineStepEditor as renderInlineStepEditorView, type StepEditorDeps } from "./stepEditors.js";
import {
  renderParametersPanel,
  renderQualityReportPanel,
  renderSelectorTestResultPanel,
  renderStepTestResultPanel,
  renderTestStatePanel,
  type RepairActionDeps
} from "./secondaryPanels.js";
import {
  applyBulkPolicy as applyBulkPolicyPanel,
  jumpToNextWeakStep as jumpToNextWeakStepPanel,
  renderActionsPanel,
  type ActionListRenderInput
} from "./actionListRenderer.js";
import { formatError, isRecordedWorkflow } from "./workflowFileUtils.js";
import {
  buildWorkflow as buildWorkflowCommand,
  copyWorkflow as copyWorkflowCommand,
  downloadWorkflow as downloadWorkflowCommand,
  hydrateWorkflowDetails as hydrateWorkflowDetailsCommand,
  importWorkflowFromFile as importWorkflowFromFileCommand,
  syncWorkflow as syncWorkflowCommand,
  type WorkflowActionDeps
} from "./workflowActions.js";
import {
  addAssertionStep as addAssertionStepCommand,
  addClickStep as addClickStepCommand,
  addDismissStep as addDismissStepCommand,
  addFillStep as addFillStepCommand,
  addNavigationStep as addNavigationStepCommand,
  addPressStep as addPressStepCommand,
  addScreenshotStep as addScreenshotStepCommand,
  addSelectStep as addSelectStepCommand,
  addWaitStep as addWaitStepCommand,
  type ManualStepDeps
} from "./manualStepCommands.js";
import {
  addSuggestedValidationStep as addSuggestedValidationStepCommand,
  applyParameterSuggestion as applyParameterSuggestionCommand,
  deleteAction as deleteActionCommand,
  highlightActionTarget as highlightActionTargetCommand,
  increaseStepTimeout as increaseStepTimeoutCommand,
  moveAction as moveActionCommand,
  pickAnchorForAction as pickAnchorForActionCommand,
  pickSelectorForAction as pickSelectorForActionCommand,
  testSelectorForAction as testSelectorForActionCommand,
  testSingleStep as testSingleStepCommand,
  updateActionDescription as updateActionDescriptionCommand,
  updateActionPatch as updateActionPatchCommand,
  updateActionSelector as updateActionSelectorCommand,
  updateConditionForAction as updateConditionForActionCommand,
  updateParameter as updateParameterCommand,
  useSelectorCandidate as useSelectorCandidateCommand,
  type StepActionDeps
} from "./stepActionCommands.js";

const recordingStateEl = mustGet("recording-state");
const statusPillEl = mustGet("status-pill");
const actionListEl = mustGet("action-list");
const emptyActionsEl = mustGet("empty-actions");
const stepSummaryEl = mustGet("step-summary");
const stepMiniMapEl = mustGet("step-mini-map");
const stepFilterInput = mustGet("step-filter") as HTMLInputElement;
const btnCollapseSteps = mustGet("btn-collapse-steps") as HTMLButtonElement;
const btnExpandRiskySteps = mustGet("btn-expand-risky-steps") as HTMLButtonElement;
const btnJumpWeakStep = mustGet("btn-jump-weak-step") as HTMLButtonElement;
const stepDensitySelect = mustGet("step-density") as HTMLSelectElement;
const bulkTargetSelect = mustGet("bulk-target") as HTMLSelectElement;
const bulkTimeoutInput = mustGet("bulk-timeout") as HTMLInputElement;
const bulkRetryCountInput = mustGet("bulk-retry-count") as HTMLInputElement;
const bulkRetryDelayInput = mustGet("bulk-retry-delay") as HTMLInputElement;
const bulkContinueOnFailureInput = mustGet("bulk-continue-on-failure") as HTMLInputElement;
const bulkScreenshotOnFailureInput = mustGet("bulk-screenshot-on-failure") as HTMLInputElement;
const btnApplyBulkPolicy = mustGet("btn-apply-bulk-policy") as HTMLButtonElement;
const parameterListEl = mustGet("parameter-list");
const messageEl = mustGet("message");
const testSummaryEl = mustGet("test-summary");
const testEventsEl = mustGet("test-events");
const qualityReportEl = mustGet("quality-report");
const qualityScoreEl = mustGet("quality-score");

const btnTheme = mustGet("btn-theme") as HTMLButtonElement;
const workflowNameInput = mustGet("workflow-name") as HTMLInputElement;
const workflowCategorySelect = mustGet("workflow-category") as HTMLSelectElement;

const btnStart = mustGet("btn-start") as HTMLButtonElement;
const btnPause = mustGet("btn-pause") as HTMLButtonElement;
const btnStop = mustGet("btn-stop") as HTMLButtonElement;
const btnClear = mustGet("btn-clear") as HTMLButtonElement;
const btnAddNavigation = mustGet("btn-add-navigation") as HTMLButtonElement;
const btnAddClick = mustGet("btn-add-click") as HTMLButtonElement;
const btnAddFill = mustGet("btn-add-fill") as HTMLButtonElement;
const btnAddSelect = mustGet("btn-add-select") as HTMLButtonElement;
const btnAddAssertion = mustGet("btn-add-assertion") as HTMLButtonElement;
const btnAddPress = mustGet("btn-add-press") as HTMLButtonElement;
const btnAddScreenshot = mustGet("btn-add-screenshot") as HTMLButtonElement;
const btnAddWait = mustGet("btn-add-wait") as HTMLButtonElement;
const btnAddDismiss = mustGet("btn-add-dismiss") as HTMLButtonElement;
const workflowImportFileInput = mustGet("workflow-import-file") as HTMLInputElement;
const btnImport = mustGet("btn-import") as HTMLButtonElement;
const btnCopy = mustGet("btn-copy") as HTMLButtonElement;
const btnDownload = mustGet("btn-download") as HTMLButtonElement;
const btnSync = mustGet("btn-sync") as HTMLButtonElement;
const btnTestWorkflow = mustGet("btn-test-workflow") as HTMLButtonElement;

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let currentWorkflow: RecordedWorkflow | undefined;
let selectedActionId: string | undefined;
let expandedActionIds = new Set<string>();
let insertAfterActionId: string | null | undefined;
let testRunning = false;
let testCurrentActionId: string | undefined;
let testEvents: WorkflowTestEvent[] = [];
let selectorTestResults: Record<string, SelectorTestResult> = {};
let stepTestResults: Record<string, { level: "success" | "error" | "info"; message: string }> = {};
let themeMode: "light" | "dark" = "light";
let workflowDetailsHydrated = false;
let stepFilterText = "";
let stepDensity: "comfortable" | "compact" = "comfortable";

void init();

async function init(): Promise<void> {
  await loadThemePreference();
  await refreshState();
  wireEvents();
}

function wireEvents(): void {
  btnStart.addEventListener("click", () => void startRecording());
  btnPause.addEventListener("click", () => void togglePause());
  btnStop.addEventListener("click", () => void stopRecording());
  btnClear.addEventListener("click", () => void clearActions());
  btnAddNavigation.addEventListener("click", () => void addToolbarStep(addNavigationStep));
  btnAddClick.addEventListener("click", () => void addToolbarStep(addClickStep));
  btnAddFill.addEventListener("click", () => void addToolbarStep(addFillStep));
  btnAddSelect.addEventListener("click", () => void addToolbarStep(addSelectStep));
  btnAddAssertion.addEventListener("click", () => void addToolbarStep(addAssertionStep));
  btnAddPress.addEventListener("click", () => void addToolbarStep(addPressStep));
  btnAddScreenshot.addEventListener("click", () => void addToolbarStep(addScreenshotStep));
  btnAddWait.addEventListener("click", () => void addToolbarStep(addWaitStep));
  btnAddDismiss.addEventListener("click", () => void addToolbarStep(addDismissStep));
  btnTheme.addEventListener("click", () => void toggleTheme());
  wireStepListEvents();

  btnImport.addEventListener("click", () => workflowImportFileInput.click());
  workflowImportFileInput.addEventListener("change", () => void importWorkflowFromFile());
  btnCopy.addEventListener("click", () => void copyWorkflow());
  btnDownload.addEventListener("click", () => void downloadWorkflow());
  btnSync.addEventListener("click", () => void syncWorkflow());
  btnTestWorkflow.addEventListener("click", () => void runTestWorkflow());

  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === "RECORDER_STATE_UPDATED") {
      recording = message.recording;
      paused = message.paused;
      actions = message.actions;
      render();
    }
    if (message.type === "TEST_WORKFLOW_STATE_UPDATED") {
      testRunning = message.running;
      testCurrentActionId = message.currentActionId;
      testEvents = message.events;
      renderTestState();
      renderActions();
    }
  });
}

function wireStepListEvents(): void {
  stepFilterInput.addEventListener("input", () => {
    stepFilterText = stepFilterInput.value.trim().toLowerCase();
    renderActions();
  });
  stepDensitySelect.addEventListener("change", () => {
    stepDensity = stepDensitySelect.value === "compact" ? "compact" : "comfortable";
    renderActions();
  });
  btnCollapseSteps.addEventListener("click", () => {
    expandedActionIds = new Set();
    renderActions();
  });
  btnExpandRiskySteps.addEventListener("click", () => {
    const riskyIds = actions
      .filter((action) => selectorConfidence(action).level === "weak" || isSubmitLikeClick(action))
      .map((action) => action.id);
    expandedActionIds = new Set(riskyIds);
    selectedActionId = riskyIds[0] ?? selectedActionId;
    renderActions();
  });
  btnJumpWeakStep.addEventListener("click", () => jumpToNextWeakStep());
  btnApplyBulkPolicy.addEventListener("click", () => void applyBulkPolicy());
}

async function loadThemePreference(): Promise<void> {
  const stored = await chrome.storage.local.get("sidepanelTheme");
  const savedTheme = stored.sidepanelTheme === "light" || stored.sidepanelTheme === "dark"
    ? stored.sidepanelTheme
    : undefined;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme ?? (prefersDark ? "dark" : "light"));
}

async function toggleTheme(): Promise<void> {
  applyTheme(themeMode === "dark" ? "light" : "dark");
  await chrome.storage.local.set({ sidepanelTheme: themeMode });
}

function applyTheme(nextTheme: "light" | "dark"): void {
  themeMode = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  const nextLabel = nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  btnTheme.title = nextLabel;
  btnTheme.setAttribute("aria-label", nextLabel);
}

async function refreshState(): Promise<void> {
  const status = await sendMessage({ type: "GET_STATUS" });
  const actionResponse = await sendMessage({ type: "GET_ACTIONS" });
  const testResponse = await sendMessage({ type: "GET_TEST_WORKFLOW_STATE" });
  recording = Boolean(status?.recording);
  paused = Boolean(status?.paused);
  actions = actionResponse?.actions ?? [];
  if (isRecordedWorkflow(actionResponse?.workflow)) {
    const workflow = actionResponse.workflow;
    currentWorkflow = workflow;
    if (!workflowDetailsHydrated) {
      hydrateWorkflowDetails(workflow, { force: true });
      workflowDetailsHydrated = true;
    }
  }
  testRunning = Boolean(testResponse?.running);
  testCurrentActionId = testResponse?.currentActionId;
  testEvents = testResponse?.events ?? [];
  render();
}

async function startRecording(): Promise<void> {
  setBusy(true);
  try {
    const response = await sendMessage({ type: "START_RECORDING" });
    if (!response?.ok) {
      setMessage(`Could not start recording: ${response?.error ?? "Unknown error"}`);
      return;
    }
    currentWorkflow = undefined;
    workflowDetailsHydrated = false;
    paused = false;
    setMessage("Recording started.");
    await refreshState();
  } catch (error) {
    setMessage(`Could not start recording: ${formatError(error)}`);
  } finally {
    setBusy(false);
  }
}

async function togglePause(): Promise<void> {
  const response = await sendMessage({ type: paused ? "RESUME_RECORDING" : "PAUSE_RECORDING" });
  if (!response?.ok) {
    setMessage(response?.error ?? "Could not update pause state.");
    return;
  }
  setMessage(paused ? "Recording resumed." : "Recording paused.");
  await refreshState();
}

async function stopRecording(): Promise<void> {
  setBusy(true);
  try {
    const response = await sendMessage({ type: "STOP_RECORDING" });
    if (response?.workflow) {
      currentWorkflow = response.workflow;
      setMessage(`Recording stopped with ${response.workflow.actions.length} step(s).`);
    }
    await refreshState();
  } catch (error) {
    setMessage(`Could not stop recording: ${formatError(error)}`);
  } finally {
    setBusy(false);
  }
}

async function clearActions(): Promise<void> {
  currentWorkflow = undefined;
  workflowDetailsHydrated = false;
  paused = false;
  await sendMessage({ type: "CLEAR_ACTIONS" });
  workflowNameInput.value = "";
  setMessage("Ready for a new recording.");
  await refreshState();
}

function manualStepDeps(): ManualStepDeps {
  return {
    insertAfterActionId,
    sendMessage,
    selectAndExpandAction,
    setInsertAfterActionId: (actionId) => { insertAfterActionId = actionId; },
    setMessage,
    refreshState
  };
}

async function addAssertionStep(): Promise<void> { await addAssertionStepCommand(manualStepDeps()); }
async function addClickStep(): Promise<void> { await addClickStepCommand(manualStepDeps()); }
async function addFillStep(): Promise<void> { await addFillStepCommand(manualStepDeps()); }
async function addSelectStep(): Promise<void> { await addSelectStepCommand(manualStepDeps()); }
async function addPressStep(): Promise<void> { await addPressStepCommand(manualStepDeps()); }
async function addScreenshotStep(): Promise<void> { await addScreenshotStepCommand(manualStepDeps()); }
async function addWaitStep(): Promise<void> { await addWaitStepCommand(manualStepDeps()); }
async function addDismissStep(): Promise<void> { await addDismissStepCommand(manualStepDeps()); }
async function addNavigationStep(): Promise<void> { await addNavigationStepCommand(manualStepDeps()); }

async function addToolbarStep(addStep: () => Promise<void>): Promise<void> {
  insertAfterActionId = undefined;
  await addStep();
}

function selectAndExpandAction(actionId: string | undefined): void {
  selectedActionId = actionId;
  expandedActionIds = actionId ? new Set([actionId]) : new Set();
}

async function runTestWorkflow(): Promise<void> {
  const response = await sendMessage({ type: "RUN_TEST_WORKFLOW" });
  if (!response?.ok) {
    setMessage(response?.error ?? "Could not start test workflow.");
  }
  await refreshState();
}

async function testWorkflowFromAction(action: RecordedAction): Promise<void> {
  selectedActionId = action.id;
  expandedActionIds = new Set([action.id]);
  const response = await sendMessage({ type: "RUN_TEST_WORKFLOW_FROM", actionId: action.id });
  if (!response?.ok) {
    setMessage(response?.error ?? "Could not start test from this step.");
  }
  await refreshState();
}

function render(): void {
  if (selectedActionId && !actions.some((action) => action.id === selectedActionId)) {
    selectedActionId = undefined;
  }
  expandedActionIds = new Set([...expandedActionIds].filter((actionId) => actions.some((action) => action.id === actionId)));
  renderStatus();
  renderActions();
  renderParameters();
  renderTestState();
  renderQualityReport();
}

function stepEditorDeps(): StepEditorDeps {
  return {
    recording,
    testRunning,
    addSuggestedValidationStep,
    highlightActionTarget,
    pickAnchorForAction,
    pickSelectorForAction,
    renderSelectorTestResult,
    renderStepTestResult,
    testSelectorForAction,
    testSingleStep,
    testWorkflowFromAction,
    updateActionPatch,
    updateActionSelector,
    updateConditionForAction,
    useSelectorCandidate
  };
}

function renderStatus(): void {
  recordingStateEl.textContent = recording
    ? paused ? "Paused; manual steps can still be added" : "Recording in the active Zoom tab"
    : "Ready";
  statusPillEl.textContent = recording ? paused ? "Paused" : "Recording" : "Idle";
  statusPillEl.classList.toggle("recording", recording);
  statusPillEl.classList.toggle("paused", recording && paused);
  statusPillEl.classList.toggle("idle", !recording);

  btnStart.disabled = recording;
  btnPause.disabled = !recording;
  btnPause.textContent = paused ? "Resume" : "Pause";
  btnStop.disabled = !recording;
  stepSummaryEl.textContent = `${actions.length} step${actions.length === 1 ? "" : "s"} captured`;
}

function renderActions(): void {
  renderActionsPanel(actionListInput());
}

function actionListInput(): ActionListRenderInput {
  return {
    actionListEl,
    emptyActionsEl,
    stepMiniMapEl,
    bulkTargetSelect,
    bulkTimeoutInput,
    bulkRetryCountInput,
    bulkRetryDelayInput,
    bulkContinueOnFailureInput,
    bulkScreenshotOnFailureInput,
    actions,
    selectedActionId,
    testCurrentActionId,
    expandedActionIds,
    insertAfterActionId,
    stepFilterText,
    stepDensity,
    testRunning,
    recording,
    setSelectedActionId: (actionId) => { selectedActionId = actionId; },
    setExpandedActionIds: (actionIds) => { expandedActionIds = actionIds; },
    setInsertAfterActionId: (actionId) => { insertAfterActionId = actionId; },
    renderActions,
    renderInlineStepEditor: (action, confidence) => renderInlineStepEditorView(action, confidence, stepEditorDeps()),
    updateActionDescription,
    testSingleStep,
    moveAction,
    deleteAction,
    updateActionPatch,
    addNavigationStep,
    addClickStep,
    addFillStep,
    addSelectStep,
    addAssertionStep,
    addPressStep,
    addScreenshotStep,
    addWaitStep,
    addDismissStep
  };
}

function jumpToNextWeakStep(): void {
  jumpToNextWeakStepPanel(actionListInput());
}

async function applyBulkPolicy(): Promise<void> {
  await applyBulkPolicyPanel(actionListInput());
  setMessage("Bulk policy applied.");
  await refreshState();
}

function renderParameters(): void {
  renderParametersPanel({ parameterListEl, actions, collectAllParameters, updateParameter, applyParameterSuggestion });
}

function renderTestState(): void {
  renderTestStatePanel({
    btnTestWorkflow,
    testSummaryEl,
    testEventsEl,
    testRunning,
    recording,
    testEvents,
    actions,
    repairDeps: repairActionDeps()
  });
}

function repairActionDeps(): RepairActionDeps {
  return {
    selectAction: (actionId) => {
      selectedActionId = actionId;
      expandedActionIds = new Set([actionId]);
    },
    render,
    pickSelectorForAction,
    pickAnchorForAction,
    increaseStepTimeout,
    addSuggestedValidationStep,
    updateActionPatch
  };
}

function stepActionDeps(): StepActionDeps {
  return {
    actions,
    selectedActionId,
    sendMessage,
    refreshState,
    render,
    setMessage,
    selectAndExpandAction,
    setSelectedActionId: (actionId) => { selectedActionId = actionId; },
    setExpandedActionIds: (actionIds) => { expandedActionIds = actionIds; },
    setInsertAfterActionId: (actionId) => { insertAfterActionId = actionId; },
    setSelectorTestResults: (results) => { selectorTestResults = results; },
    getSelectorTestResults: () => selectorTestResults,
    setStepTestResults: (results) => { stepTestResults = results; },
    getStepTestResults: () => stepTestResults
  };
}

async function increaseStepTimeout(action: RecordedAction): Promise<void> {
  await increaseStepTimeoutCommand(stepActionDeps(), action);
}

function renderQualityReport(): void {
  renderQualityReportPanel({ actions, qualityScoreEl, qualityReportEl });
}

function renderSelectorTestResult(action: RecordedAction): HTMLElement {
  return renderSelectorTestResultPanel(action, selectorTestResults, useSelectorCandidate);
}

function renderStepTestResult(action: RecordedAction): HTMLElement {
  return renderStepTestResultPanel(action, stepTestResults);
}

async function updateActionDescription(actionId: string, description: string): Promise<void> { await updateActionDescriptionCommand(stepActionDeps(), actionId, description); }
async function updateActionPatch(actionId: string, update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId">): Promise<void> { await updateActionPatchCommand(stepActionDeps(), actionId, update); }
async function updateActionSelector(actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void> { await updateActionSelectorCommand(stepActionDeps(), actionId, cssSelector, selectorNote); }
async function updateConditionForAction(action: RecordedAction, type: NonNullable<RecordedAction["condition"]>["type"], text: string): Promise<void> { await updateConditionForActionCommand(stepActionDeps(), action, type, text); }
async function testSelectorForAction(action: RecordedAction): Promise<void> { await testSelectorForActionCommand(stepActionDeps(), action); }
async function highlightActionTarget(action: RecordedAction): Promise<void> { await highlightActionTargetCommand(stepActionDeps(), action); }
async function testSingleStep(action: RecordedAction): Promise<void> { await testSingleStepCommand(stepActionDeps(), action); }
async function pickSelectorForAction(action: RecordedAction): Promise<void> { await pickSelectorForActionCommand(stepActionDeps(), action); }
async function pickAnchorForAction(action: RecordedAction): Promise<void> { await pickAnchorForActionCommand(stepActionDeps(), action); }
async function useSelectorCandidate(actionId: string, selector: RecordedAction["selectors"]): Promise<void> { await useSelectorCandidateCommand(stepActionDeps(), actionId, selector); }
async function addSuggestedValidationStep(actionOverride?: RecordedAction): Promise<void> { await addSuggestedValidationStepCommand(stepActionDeps(), actionOverride); }
async function moveAction(actionId: string, direction: "up" | "down"): Promise<void> { await moveActionCommand(stepActionDeps(), actionId, direction); }
async function deleteAction(actionId: string): Promise<void> { await deleteActionCommand(stepActionDeps(), actionId); }
async function updateParameter(actionId: string, paramIndex: number, confirmed: boolean): Promise<void> { await updateParameterCommand(stepActionDeps(), actionId, paramIndex, confirmed); }
async function applyParameterSuggestion(suggestion: ReturnType<typeof suggestParameterReplacements>[number]): Promise<void> { await applyParameterSuggestionCommand(stepActionDeps(), suggestion); }

function workflowActionDeps(): WorkflowActionDeps {
  return {
    workflowImportFileInput,
    workflowNameInput,
    workflowCategorySelect,
    currentWorkflow,
    sendMessage,
    getServerUrl,
    refreshState,
    setMessage,
    setCurrentWorkflow: (workflow) => { currentWorkflow = workflow; },
    setWorkflowDetailsHydrated: (value) => { workflowDetailsHydrated = value; },
    setSelectedActionId: (actionId) => { selectedActionId = actionId; },
    setInsertAfterActionId: (actionId) => { insertAfterActionId = actionId; },
    setSelectorTestResults: (results) => { selectorTestResults = results; },
    setStepTestResults: (results) => { stepTestResults = results; }
  };
}

async function copyWorkflow(): Promise<void> { await copyWorkflowCommand(workflowActionDeps()); }
async function downloadWorkflow(): Promise<void> { await downloadWorkflowCommand(workflowActionDeps()); }
async function importWorkflowFromFile(): Promise<void> { await importWorkflowFromFileCommand(workflowActionDeps()); }
function hydrateWorkflowDetails(workflow: RecordedWorkflow, options: { force?: boolean } = {}): void { hydrateWorkflowDetailsCommand(workflowActionDeps(), workflow, options); }
async function syncWorkflow(): Promise<void> { await syncWorkflowCommand(workflowActionDeps()); }
async function buildWorkflow(): Promise<RecordedWorkflow> { return await buildWorkflowCommand(workflowActionDeps()); }

function selectedAction(): RecordedAction | undefined {
  return actions.find((action) => action.id === selectedActionId);
}

function setBusy(busy: boolean): void {
  btnStart.disabled = busy || recording;
  btnStop.disabled = busy || !recording;
}

function setMessage(message: string): void {
  messageEl.textContent = message;
}

async function sendMessage(message: ExtensionMessage): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

async function getServerUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("serverUrl");
  return stored.serverUrl ?? "http://localhost:4174";
}

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}
