import { isCommitClickLabel, scoreSelector } from "@zoom-automation/workflow-core";
import type { ExtensionMessage, ParameterHint, RecordedAction, RecordedWorkflow, AnchorPickResult, SelectorPickResult, SelectorTestResult, WorkflowQualityReport, WorkflowTestEvent } from "../shared/types.js";

const recordingStateEl = mustGet("recording-state");
const statusPillEl = mustGet("status-pill");
const actionListEl = mustGet("action-list");
const emptyActionsEl = mustGet("empty-actions");
const stepSummaryEl = mustGet("step-summary");
const parameterListEl = mustGet("parameter-list");
const messageEl = mustGet("message");
const testSummaryEl = mustGet("test-summary");
const testEventsEl = mustGet("test-events");
const inspectorSummaryEl = mustGet("inspector-summary");
const inspectorEmptyEl = mustGet("inspector-empty");
const inspectorFieldsEl = mustGet("inspector-fields");
const selectorTestResultEl = mustGet("selector-test-result");
const qualityReportEl = mustGet("quality-report");
const qualityScoreEl = mustGet("quality-score");

const btnTheme = mustGet("btn-theme") as HTMLButtonElement;
const workflowNameInput = mustGet("workflow-name") as HTMLInputElement;
const workflowCategorySelect = mustGet("workflow-category") as HTMLSelectElement;
const inspectorDescriptionInput = mustGet("inspector-description") as HTMLInputElement;
const stepTimeoutInput = mustGet("step-timeout") as HTMLInputElement;
const stepRetryCountInput = mustGet("step-retry-count") as HTMLInputElement;
const stepRetryDelayInput = mustGet("step-retry-delay") as HTMLInputElement;
const stepContinueOnFailureInput = mustGet("step-continue-on-failure") as HTMLInputElement;
const stepScreenshotOnFailureInput = mustGet("step-screenshot-on-failure") as HTMLInputElement;
const stepConditionSelect = mustGet("step-condition") as HTMLSelectElement;
const stepConditionTextInput = mustGet("step-condition-text") as HTMLInputElement;
const manualUrlInput = mustGet("manual-url") as HTMLInputElement;
const assertTypeSelect = mustGet("assert-type") as HTMLSelectElement;
const assertExpectedInput = mustGet("assert-expected") as HTMLInputElement;
const assertTimeoutInput = mustGet("assert-timeout") as HTMLInputElement;
const assertOnFailureSelect = mustGet("assert-on-failure") as HTMLSelectElement;
const screenshotLabelInput = mustGet("screenshot-label") as HTMLInputElement;
const waitMsInput = mustGet("wait-ms") as HTMLInputElement;
const actionValueInput = mustGet("action-value") as HTMLInputElement;
const actionValueLabel = mustGet("action-value-label") as HTMLLabelElement;
const pressKeySelect = mustGet("press-key") as HTMLSelectElement;

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
const btnTestStep = mustGet("btn-test-step") as HTMLButtonElement;
const stepTestResultEl = mustGet("step-test-result");
const btnPickSelector = mustGet("btn-pick-selector") as HTMLButtonElement;
const btnPickAnchor = mustGet("btn-pick-anchor") as HTMLButtonElement;
const btnTestSelector = mustGet("btn-test-selector") as HTMLButtonElement;
const btnAddSuggestedValidation = mustGet("btn-add-suggested-validation") as HTMLButtonElement;

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let currentWorkflow: RecordedWorkflow | undefined;
let selectedActionId: string | undefined;
let insertAfterActionId: string | null | undefined;
let testRunning = false;
let testCurrentActionId: string | undefined;
let testEvents: WorkflowTestEvent[] = [];
let selectorTestResults: Record<string, SelectorTestResult> = {};
let stepTestResults: Record<string, { level: "success" | "error" | "info"; message: string }> = {};
let themeMode: "light" | "dark" = "light";
let workflowDetailsHydrated = false;

interface SelectorConfidence {
  level: "strong" | "medium" | "weak" | "manual";
  reason: string;
}

type StepToolbarIcon = "navigate" | "click" | "fill" | "select" | "validate" | "press" | "screenshot" | "wait" | "dismiss";

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
  wireInspectorEvents();

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

function wireInspectorEvents(): void {
  inspectorDescriptionInput.addEventListener("blur", () => void updateSelectedAction({ description: inspectorDescriptionInput.value }));
  manualUrlInput.addEventListener("blur", () => void updateSelectedAction({ url: manualUrlInput.value }));
  manualUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      manualUrlInput.blur();
    }
  });

  assertTypeSelect.addEventListener("change", () => void updateSelectedAction({ assertionType: assertTypeSelect.value as RecordedAction["assertionType"] }));
  assertExpectedInput.addEventListener("blur", () => void updateSelectedAction({ expected: assertExpectedInput.value }));
  assertExpectedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      assertExpectedInput.blur();
    }
  });
  assertTimeoutInput.addEventListener("blur", () => void updateSelectedAction({ timeout: Number(assertTimeoutInput.value) || 10_000 }));
  assertOnFailureSelect.addEventListener("change", () => void updateSelectedAction({ onFailure: assertOnFailureSelect.value as RecordedAction["onFailure"] }));

  screenshotLabelInput.addEventListener("blur", () => void updateSelectedAction({ screenshotLabel: screenshotLabelInput.value }));
  screenshotLabelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      screenshotLabelInput.blur();
    }
  });

  waitMsInput.addEventListener("blur", () => void updateSelectedAction({ waitMs: Number(waitMsInput.value) || 1_000 }));
  actionValueInput.addEventListener("blur", () => void updateSelectedAction({ value: actionValueInput.value }));
  actionValueInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      actionValueInput.blur();
    }
  });
  pressKeySelect.addEventListener("change", () => void updateSelectedAction({ key: pressKeySelect.value }));

  stepTimeoutInput.addEventListener("blur", () => void updateSelectedAction({ timeout: Number(stepTimeoutInput.value) || 10_000 }));
  stepRetryCountInput.addEventListener("blur", () => void updateSelectedAction({ retryCount: Number(stepRetryCountInput.value) || 0 }));
  stepRetryDelayInput.addEventListener("blur", () => void updateSelectedAction({ retryDelayMs: Number(stepRetryDelayInput.value) || 1_000 }));
  stepContinueOnFailureInput.addEventListener("change", () => void updateSelectedAction({ continueOnFailure: stepContinueOnFailureInput.checked }));
  stepScreenshotOnFailureInput.addEventListener("change", () => void updateSelectedAction({ screenshotOnFailure: stepScreenshotOnFailureInput.checked }));
  stepConditionSelect.addEventListener("change", () => void updateCondition());
  stepConditionTextInput.addEventListener("blur", () => void updateCondition());
  btnTestStep.addEventListener("click", () => {
    const action = selectedAction();
    if (action) void testSingleStep(action);
  });
  btnPickSelector.addEventListener("click", () => void pickSelectedSelector());
  btnPickAnchor.addEventListener("click", () => void pickSelectedAnchor());
  btnTestSelector.addEventListener("click", () => void testSelectedSelector());
  btnAddSuggestedValidation.addEventListener("click", () => void addSuggestedValidationStep());
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

async function addAssertionStep(): Promise<void> {
  const response = await sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: "textVisible",
    expected: "",
    timeout: 10_000,
    onFailure: "screenshot",
    insertAfterActionId
  });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Validation step added. Configure it in Properties.");
  await refreshState();
}

async function addClickStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_CLICK_ACTION", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Click step added. Add a stable selector in Selector details.");
  await refreshState();
}

async function addFillStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_FILL_ACTION", value: "", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Text entry step added. Configure the value and selector in Properties.");
  await refreshState();
}

async function addSelectStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_SELECT_ACTION", value: "", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Select option step added. Configure the option and selector in Properties.");
  await refreshState();
}

async function addPressStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_PRESS_ACTION", key: "Enter", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Key press step added. Configure the key in Properties.");
  await refreshState();
}

async function addScreenshotStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_SCREENSHOT_ACTION", label: "evidence", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Screenshot step added. Configure it in Properties.");
  await refreshState();
}

async function addWaitStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_WAIT_ACTION", waitMs: 1_000, insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Wait step added. Configure it in Properties.");
  await refreshState();
}

async function addDismissStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_DISMISS_ACTION", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Dismiss popup step added.");
  await refreshState();
}

async function addNavigationStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_NAVIGATION_ACTION", url: "/", insertAfterActionId });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Navigation step added. Configure it in Properties.");
  await refreshState();
}

async function addToolbarStep(addStep: () => Promise<void>): Promise<void> {
  insertAfterActionId = undefined;
  await addStep();
}

async function runTestWorkflow(): Promise<void> {
  const response = await sendMessage({ type: "RUN_TEST_WORKFLOW" });
  if (!response?.ok) {
    setMessage(response?.error ?? "Could not start test workflow.");
  }
  await refreshState();
}

function render(): void {
  if (selectedActionId && !actions.some((action) => action.id === selectedActionId)) {
    selectedActionId = undefined;
  }
  renderStatus();
  renderActions();
  renderInspector();
  renderParameters();
  renderTestState();
  renderQualityReport();
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
  actionListEl.innerHTML = "";
  emptyActionsEl.style.display = actions.length === 0 ? "grid" : "none";

  if (actions.length === 0) {
    actionListEl.appendChild(renderInsertRow(null));
    return;
  }

  actions.forEach((action, index) => {
    const item = document.createElement("article");
    item.className = `action-item${action.id === selectedActionId ? " selected" : ""}${action.id === testCurrentActionId ? " testing" : ""}`;
    item.addEventListener("click", () => {
      selectedActionId = action.id;
      render();
    });

    const main = document.createElement("div");
    main.className = "action-main";

    const indexEl = document.createElement("span");
    indexEl.className = "action-index";
    indexEl.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "action-body";

    const meta = document.createElement("div");
    meta.className = "action-meta";

    const type = document.createElement("span");
    type.className = "action-type";
    type.textContent = action.type;

    const confidence = selectorConfidence(action);
    const confidenceBadge = document.createElement("span");
    confidenceBadge.className = `confidence ${confidence.level}`;
    confidenceBadge.title = confidence.reason;
    confidenceBadge.textContent = confidence.level;

    const context = document.createElement("span");
    context.className = "action-context";
    context.title = action.url ?? action.value ?? action.pageUrl;
    context.textContent = action.url ?? action.value ?? action.pageUrl;

    meta.append(type, confidenceBadge, context);

    const description = document.createElement("input");
    description.className = "action-description";
    description.type = "text";
    description.value = action.description ?? describeAction(action);
    description.addEventListener("blur", () => void updateActionDescription(action.id, description.value));
    description.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        description.blur();
      }
    });

    body.append(meta, description);
    main.append(indexEl, body);

    const controls = document.createElement("div");
    controls.className = "action-actions";
    controls.append(
      makeActionButton("Test", testRunning || recording, () => void testSingleStep(action)),
      makeActionButton("Up", index === 0, () => moveAction(action.id, "up")),
      makeActionButton("Down", index === actions.length - 1, () => moveAction(action.id, "down")),
      makeActionButton("Delete", false, () => deleteAction(action.id), "delete")
    );

    item.append(main, controls);
    item.appendChild(renderSelectorRepair(action, confidence));
    actionListEl.appendChild(item);
    actionListEl.appendChild(renderInsertRow(action.id, index === actions.length - 1));
  });
}

function renderInsertRow(afterActionId: string | null, isLast = false): HTMLElement {
  const row = document.createElement("div");
  row.className = `insert-row${insertAfterActionId === afterActionId ? " open" : ""}${isLast ? " last" : ""}`;

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "insert-plus";
  plus.title = afterActionId === null ? "Insert first step" : "Insert step here";
  plus.textContent = "+";
  plus.addEventListener("click", () => {
    insertAfterActionId = insertAfterActionId === afterActionId ? undefined : afterActionId;
    renderActions();
  });
  row.appendChild(plus);

  if (insertAfterActionId === afterActionId) {
    const tools = document.createElement("div");
    tools.className = "insert-tools";
    tools.append(
      makeInsertTool("navigate", "Navigate", () => void addNavigationStep()),
      makeInsertTool("click", "Click", () => void addClickStep()),
      makeInsertTool("fill", "Type text", () => void addFillStep()),
      makeInsertTool("select", "Select option", () => void addSelectStep()),
      makeInsertTool("validate", "Validate", () => void addAssertionStep()),
      makeInsertTool("press", "Press key", () => void addPressStep()),
      makeInsertTool("screenshot", "Shot", () => void addScreenshotStep()),
      makeInsertTool("wait", "Wait", () => void addWaitStep()),
      makeInsertTool("dismiss", "Dismiss popup", () => void addDismissStep())
    );
    row.appendChild(tools);
  }

  return row;
}

function makeInsertTool(icon: StepToolbarIcon, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "insert-tool";
  button.title = label;
  button.setAttribute("aria-label", label);
  const iconEl = document.createElement("span");
  iconEl.className = "insert-tool-icon";
  iconEl.innerHTML = toolbarIconSvg(icon);
  iconEl.setAttribute("aria-hidden", "true");
  button.append(iconEl);
  button.addEventListener("click", onClick);
  return button;
}

function renderInspector(): void {
  const action = selectedAction();
  inspectorEmptyEl.classList.toggle("hidden", Boolean(action));
  inspectorFieldsEl.classList.toggle("hidden", !action);

  if (!action) {
    inspectorSummaryEl.textContent = "Select a step to configure it.";
    return;
  }

  inspectorSummaryEl.textContent = `${action.type} step`;
  inspectorDescriptionInput.value = action.description ?? describeAction(action);
  btnTestStep.disabled = testRunning || recording;
  stepTimeoutInput.value = String(action.timeout ?? 10_000);
  stepRetryCountInput.value = String(action.retryCount ?? 0);
  stepRetryDelayInput.value = String(action.retryDelayMs ?? 1_000);
  stepContinueOnFailureInput.checked = Boolean(action.continueOnFailure);
  stepScreenshotOnFailureInput.checked = Boolean(action.screenshotOnFailure);
  stepConditionSelect.value = action.condition?.type ?? "none";
  stepConditionTextInput.value = action.condition?.text ?? "";

  const selectorBased = isSelectorBased(action);
  togglePropertyField("field-selector-test", selectorBased);
  togglePropertyField("field-url", action.type === "navigate");
  togglePropertyField("field-assertion", action.type === "assert");
  togglePropertyField("field-validation-suggestion", isSubmitLikeClick(action));
  togglePropertyField("field-action-value", action.type === "fill" || action.type === "select");
  togglePropertyField("field-key", action.type === "press");
  togglePropertyField("field-screenshot", action.type === "screenshot");
  togglePropertyField("field-wait", action.type === "wait");

  if (action.type === "navigate") {
    manualUrlInput.value = action.url ?? "";
  }
  if (action.type === "assert") {
    assertTypeSelect.value = action.assertionType ?? "textVisible";
    assertExpectedInput.value = action.expected ?? "";
    assertTimeoutInput.value = String(action.timeout ?? 10_000);
    assertOnFailureSelect.value = action.onFailure ?? "screenshot";
  }
  if (action.type === "fill" || action.type === "select") {
    actionValueLabel.textContent = action.type === "fill" ? "Text" : "Option value";
    actionValueInput.placeholder = action.type === "fill" ? "Text to enter" : "Visible option text or value";
    actionValueInput.value = action.value ?? "";
  }
  if (action.type === "press") {
    pressKeySelect.value = action.key ?? "Enter";
  }
  if (action.type === "screenshot") {
    screenshotLabelInput.value = action.screenshotLabel ?? "evidence";
  }
  if (action.type === "wait") {
    waitMsInput.value = String(action.waitMs ?? 1_000);
  }
  renderStepTestResult(action);
  renderSelectorTestResult(action);
}

function togglePropertyField(id: string, visible: boolean): void {
  mustGet(id).classList.toggle("hidden", !visible);
}

function renderSelectorRepair(action: RecordedAction, confidence: SelectorConfidence): HTMLElement {
  const wrapper = document.createElement("details");
  wrapper.className = "selector-repair";

  const summary = document.createElement("summary");
  summary.textContent = `Selector details: ${confidence.reason}`;
  wrapper.appendChild(summary);

  const grid = document.createElement("div");
  grid.className = "selector-grid";

  const detail = document.createElement("div");
  detail.className = "selector-detail";
  detail.title = formatSelectors(action);
  detail.textContent = formatSelectors(action);

  const confidenceScore = scoreSelector(action.selectors);
  const confidenceDetail = document.createElement("div");
  confidenceDetail.className = "selector-confidence";
  confidenceDetail.textContent = `Confidence ${confidenceScore.score}/100: ${confidenceScore.reasons.join("; ") || confidence.reason}`;

  const cssLabel = document.createElement("label");
  cssLabel.className = "field-label";
  cssLabel.textContent = "CSS fallback override";
  const cssInput = document.createElement("input");
  cssInput.type = "text";
  cssInput.value = action.selectors.css ?? "";
  cssInput.placeholder = "[data-testid='save-button']";
  cssInput.addEventListener("blur", () => void updateActionSelector(action.id, cssInput.value, undefined));
  cssInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") cssInput.blur();
  });

  const noteLabel = document.createElement("label");
  noteLabel.className = "field-label";
  noteLabel.textContent = "Selector note";
  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.value = action.selectorNote ?? "";
  noteInput.placeholder = "Why this selector is stable or how to repair it";
  noteInput.addEventListener("blur", () => void updateActionSelector(action.id, undefined, noteInput.value));
  noteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") noteInput.blur();
  });

  grid.append(detail, confidenceDetail, cssLabel, cssInput, noteLabel, noteInput);
  wrapper.appendChild(grid);
  return wrapper;
}

function renderParameters(): void {
  parameterListEl.innerHTML = "";
  const parameters = collectAllParameters(actions);

  if (parameters.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No reusable values detected yet.";
    parameterListEl.appendChild(empty);
    return;
  }

  for (const { actionId, paramIndex, hint } of parameters) {
    const item = document.createElement("div");
    item.className = "param-item";

    const text = document.createElement("div");
    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = `{{${hint.suggestedName}}}`;
    const value = document.createElement("span");
    value.className = "param-value";
    value.title = hint.originalValue;
    value.textContent = hint.originalValue;
    text.append(name, value);

    const buttons = document.createElement("div");
    buttons.className = "param-buttons";
    buttons.append(
      makeParamButton("Param", hint.confirmed !== false, () => updateParameter(actionId, paramIndex, true)),
      makeParamButton("Literal", hint.confirmed === false, () => updateParameter(actionId, paramIndex, false))
    );

    item.append(text, buttons);
    parameterListEl.appendChild(item);
  }
}

function renderTestState(): void {
  btnTestWorkflow.disabled = testRunning || recording;
  btnTestWorkflow.textContent = testRunning ? "Testing" : "Test";
  testSummaryEl.textContent = testRunning
    ? "Testing workflow in the active tab..."
    : "Run the current workflow in this browser tab.";

  testEventsEl.innerHTML = "";
  for (const event of testEvents.slice(-8)) {
    const item = document.createElement("div");
    item.className = `test-event ${event.level}`;
    item.textContent = `${new Date(event.timestamp).toLocaleTimeString()} ${event.message}`;
    testEventsEl.appendChild(item);
  }

  const failedEvent = [...testEvents].reverse().find((event) => event.level === "error" && event.actionId);
  const failedAction = failedEvent?.actionId ? actions.find((action) => action.id === failedEvent.actionId) : undefined;
  if (failedAction) {
    testEventsEl.appendChild(renderRepairActions(failedAction));
  }
}

function renderRepairActions(action: RecordedAction): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "repair-actions";

  wrapper.appendChild(makeRepairButton("Select step", () => {
    selectedActionId = action.id;
    render();
  }));

  if (isSelectorBased(action)) {
    wrapper.appendChild(makeRepairButton("Re-pick target", () => {
      selectedActionId = action.id;
      render();
      void pickSelectorForAction(action);
    }));
    wrapper.appendChild(makeRepairButton("Pick anchor", () => {
      selectedActionId = action.id;
      render();
      void pickAnchorForAction(action);
    }));
  }

  wrapper.appendChild(makeRepairButton("Increase timeout", () => void increaseStepTimeout(action)));

  if (isSubmitLikeClick(action)) {
    wrapper.appendChild(makeRepairButton("Add validation", () => {
      selectedActionId = action.id;
      render();
      void addSuggestedValidationStep();
    }));
  }

  wrapper.appendChild(makeRepairButton("Continue on fail", () => void updateActionPatch(action.id, { continueOnFailure: true, screenshotOnFailure: true })));
  return wrapper;
}

function makeRepairButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function increaseStepTimeout(action: RecordedAction): Promise<void> {
  const nextTimeout = Math.min((action.timeout ?? 10_000) + 5_000, 60_000);
  await updateActionPatch(action.id, { timeout: nextTimeout });
  setMessage(`Timeout increased to ${nextTimeout}ms.`);
}

function renderQualityReport(): void {
  const report = calculateQualityReport(actions);
  qualityScoreEl.textContent = `${report.score}`;
  qualityScoreEl.className = `quality-score ${report.score >= 80 ? "good" : report.score >= 60 ? "warn" : "bad"}`;
  qualityReportEl.innerHTML = "";

  const metrics = [
    ["Selector stability", report.selectorStability],
    ["Assertion coverage", report.assertionCoverage],
    ["Evidence coverage", report.evidenceCoverage]
  ] as const;

  for (const [label, value] of metrics) {
    const row = document.createElement("div");
    row.className = "quality-row";
    row.innerHTML = `<span>${label}</span><strong>${value}%</strong>`;
    qualityReportEl.appendChild(row);
  }

  const risk = document.createElement("div");
  risk.className = "quality-risk-grid";
  risk.innerHTML = `
    <span>Risky steps <strong>${report.riskySteps}</strong></span>
    <span>Hardcoded values <strong>${report.hardcodedValues}</strong></span>
    <span>Unsupported test steps <strong>${report.unsupportedBrowserPreflightSteps}</strong></span>
  `;
  qualityReportEl.appendChild(risk);

  if (report.warnings.length > 0) {
    const list = document.createElement("ul");
    list.className = "quality-warnings";
    for (const warning of report.warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.appendChild(item);
    }
    qualityReportEl.appendChild(list);
  }
}

function renderSelectorTestResult(action: RecordedAction): void {
  const result = selectorTestResults[action.id];
  selectorTestResultEl.innerHTML = "";
  if (!result) {
    selectorTestResultEl.textContent = hasUsableSelector(action)
      ? "Test this selector against the current page."
      : "Pick the real page target to populate this step.";
    return;
  }
  if (result.error) {
    selectorTestResultEl.textContent = `Selector test failed: ${result.error}`;
    selectorTestResultEl.className = "selector-test-result error";
    return;
  }
  selectorTestResultEl.className = "selector-test-result";
  const summary = document.createElement("div");
  summary.className = "selector-test-summary";
  summary.innerHTML = `<strong>${result.visibleCount}/${result.matchedCount}</strong><span>visible / matched</span>`;
  selectorTestResultEl.appendChild(summary);
  if (result.chosenPreview) {
    const preview = document.createElement("div");
    preview.className = "selector-preview";
    preview.textContent = `${result.chosenSelector ?? "Chosen"}: ${result.chosenPreview}`;
    selectorTestResultEl.appendChild(preview);
  }
  if (result.fallbackCandidates.length > 0) {
    const list = document.createElement("div");
    list.className = "selector-candidates";
    for (const candidate of result.fallbackCandidates) {
      const item = document.createElement("div");
      item.className = "selector-candidate";
      const label = document.createElement("span");
      label.textContent = `${candidate.label}: ${candidate.visibleCount}/${candidate.matchedCount} visible`;
      const use = document.createElement("button");
      use.type = "button";
      use.className = "icon-button";
      use.textContent = "Use";
      use.disabled = candidate.visibleCount === 0;
      use.addEventListener("click", () => void useSelectorCandidate(action.id, candidate.selector));
      item.append(label, use);
      list.appendChild(item);
    }
    selectorTestResultEl.appendChild(list);
  }
}

function renderStepTestResult(action: RecordedAction): void {
  const result = stepTestResults[action.id];
  stepTestResultEl.className = "selector-test-result";
  if (!result) {
    stepTestResultEl.textContent = "Test only this step against the current page.";
    return;
  }
  stepTestResultEl.classList.toggle("error", result.level === "error");
  stepTestResultEl.textContent = result.message;
}

function makeActionButton(label: string, disabled: boolean, onClick: () => void, className?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button${className ? ` ${className}` : ""}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", () => onClick());
  return button;
}

function makeParamButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = active ? `[${label}]` : label;
  button.addEventListener("click", () => onClick());
  return button;
}

async function updateActionDescription(actionId: string, description: string): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, description });
  await refreshState();
}

async function updateSelectedAction(update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId">): Promise<void> {
  if (!selectedActionId) return;
  await updateActionPatch(selectedActionId, update);
}

async function updateActionPatch(actionId: string, update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId">): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, ...update });
  await refreshState();
}

async function updateActionSelector(actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, cssSelector, selectorNote });
  await refreshState();
}

async function updateCondition(): Promise<void> {
  if (!selectedActionId) return;
  const action = selectedAction();
  const type = stepConditionSelect.value as NonNullable<RecordedAction["condition"]>["type"];
  await updateSelectedAction({
    condition: {
      type,
      text: stepConditionTextInput.value.trim() || undefined,
      selector: action?.selectors
    }
  });
}

async function testSelectedSelector(): Promise<void> {
  const action = selectedAction();
  if (!action) return;
  selectorTestResultEl.textContent = "Testing selector in the active page...";
  const result = await sendMessage({ type: "TEST_SELECTOR", action }) as SelectorTestResult;
  selectorTestResults = { ...selectorTestResults, [action.id]: result };
  renderSelectorTestResult(action);
}

async function testSingleStep(action: RecordedAction): Promise<void> {
  selectedActionId = action.id;
  stepTestResults = {
    ...stepTestResults,
    [action.id]: { level: "info", message: "Testing this step against the active tab..." }
  };
  render();

  const response = await sendMessage({ type: "RUN_TEST_ACTION", action });
  stepTestResults = {
    ...stepTestResults,
    [action.id]: {
      level: response?.ok ? "success" : "error",
      message: response?.ok
        ? `Passed: ${action.description ?? action.type}`
        : `Failed: ${response?.error ?? "Step test failed."}`
    }
  };
  setMessage(response?.ok ? "Step test passed." : (response?.error ?? "Step test failed."));
  await refreshState();
}

async function pickSelectedSelector(): Promise<void> {
  const action = selectedAction();
  if (!action) return;
  await pickSelectorForAction(action);
}

async function pickSelectorForAction(action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "press", "assert"].includes(action.type)) {
    setMessage("This step does not need a page target.");
    return;
  }

  selectorTestResultEl.textContent = "Click the target element in the active Zoom tab. Press Esc to cancel.";
  const result = await sendMessage({ type: "PICK_SELECTOR", action }) as SelectorPickResult;
  if (result.error) {
    selectorTestResults = {
      ...selectorTestResults,
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error }
    };
    renderSelectorTestResult(action);
    setMessage(result.error);
    return;
  }

  const update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId"> = {
    selectors: result.selectors,
    frameSelector: result.frameSelector,
    description: result.description
  };
  if ((action.type === "fill" || action.type === "select") && result.value) {
    update.value = result.value;
  }
  if (action.type === "assert" && result.value) {
    update.assertionType = "textVisible";
    update.expected = result.value;
  }
  await sendMessage({ type: "UPDATE_ACTION", actionId: action.id, ...update });
  selectorTestResults = {
    ...selectorTestResults,
    [action.id]: {
      actionId: action.id,
      matchedCount: 1,
      visibleCount: 1,
      chosenPreview: result.preview,
      chosenSelector: formatSelectors({ ...action, selectors: result.selectors }),
      fallbackCandidates: []
    }
  };
  setMessage("Target selected for this step.");
  await refreshState();
}

async function pickSelectedAnchor(): Promise<void> {
  const action = selectedAction();
  if (!action) return;
  await pickAnchorForAction(action);
}

async function pickAnchorForAction(action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "press"].includes(action.type)) {
    setMessage("This step does not need an anchor.");
    return;
  }
  if (!hasUsableSelector(action)) {
    setMessage("Pick a target before adding an anchor.");
    return;
  }

  selectorTestResultEl.textContent = "Click stable row or list text in the active Zoom tab. Press Esc to cancel.";
  const result = await sendMessage({ type: "PICK_ANCHOR", action }) as AnchorPickResult;
  if (result.error || !result.anchor) {
    selectorTestResults = {
      ...selectorTestResults,
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error ?? "No anchor was selected." }
    };
    renderSelectorTestResult(action);
    setMessage(result.error ?? "No anchor was selected.");
    return;
  }

  const selectors = { ...action.selectors, anchor: result.anchor };
  await sendMessage({ type: "UPDATE_ACTION", actionId: action.id, selectors });
  selectorTestResults = {
    ...selectorTestResults,
    [action.id]: {
      actionId: action.id,
      matchedCount: 1,
      visibleCount: 1,
      chosenPreview: result.preview,
      chosenSelector: formatSelectors({ ...action, selectors }),
      fallbackCandidates: []
    }
  };
  setMessage("Anchor selected for this step.");
  await refreshState();
}

async function useSelectorCandidate(actionId: string, selector: RecordedAction["selectors"]): Promise<void> {
  const action = actions.find((candidate) => candidate.id === actionId);
  const selectors = action?.selectors.anchor && !selector.anchor
    ? { ...selector, anchor: action.selectors.anchor }
    : selector;
  await updateActionPatch(actionId, { selectors });
  setMessage("Selector candidate applied.");
}

async function addSuggestedValidationStep(): Promise<void> {
  const action = selectedAction();
  if (!action || !isSubmitLikeClick(action)) return;

  const response = await sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: "textVisible",
    expected: "success|saved|added|submitted",
    timeout: 10_000,
    onFailure: "screenshot",
    insertAfterActionId: action.id
  });
  selectedActionId = response?.actionId;
  insertAfterActionId = undefined;
  setMessage("Validation step added after the submit action.");
  await refreshState();
}

async function moveAction(actionId: string, direction: "up" | "down"): Promise<void> {
  await sendMessage({ type: "MOVE_ACTION", actionId, direction });
  await refreshState();
}

async function deleteAction(actionId: string): Promise<void> {
  await sendMessage({ type: "DELETE_ACTION", actionId });
  setMessage("Step deleted.");
  await refreshState();
}

async function updateParameter(actionId: string, paramIndex: number, confirmed: boolean): Promise<void> {
  await sendMessage({ type: "UPDATE_PARAMETER", actionId, paramIndex, confirmed });
  await refreshState();
}

async function copyWorkflow(): Promise<void> {
  const workflow = await buildWorkflow();
  await navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
  setMessage("Workflow JSON copied.");
}

async function downloadWorkflow(): Promise<void> {
  const workflow = await buildWorkflow();
  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(workflow.meta.name || "workflow")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setMessage("Workflow JSON downloaded.");
}

async function importWorkflowFromFile(): Promise<void> {
  const file = workflowImportFileInput.files?.[0];
  workflowImportFileInput.value = "";
  if (!file) return;

  try {
    const workflow = parseWorkflowJson(await file.text());
    const response = await sendMessage({ type: "IMPORT_WORKFLOW", workflow });
    if (!response?.ok) {
      setMessage(`Import failed: ${response?.error ?? "Unknown error"}`);
      return;
    }

    currentWorkflow = workflow;
    workflowDetailsHydrated = true;
    selectedActionId = workflow.actions[0]?.id;
    insertAfterActionId = undefined;
    selectorTestResults = {};
    stepTestResults = {};
    hydrateWorkflowDetails(workflow, { force: true });
    setMessage(`Imported "${workflow.meta.name || file.name}" with ${workflow.actions.length} step(s).`);
    await refreshState();
  } catch (error) {
    setMessage(`Import failed: ${formatError(error)}`);
  }
}

function parseWorkflowJson(rawJson: string): RecordedWorkflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (!isRecordedWorkflow(parsed)) {
    throw new Error("The selected file is not a recorded workflow JSON file.");
  }
  if (parsed.actions.length === 0) {
    throw new Error("The selected workflow does not contain any steps.");
  }
  return parsed;
}

function isRecordedWorkflow(value: unknown): value is RecordedWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecordedWorkflow>;
  return candidate.version === 1
    && Boolean(candidate.meta && typeof candidate.meta === "object")
    && Array.isArray(candidate.actions);
}

function hydrateWorkflowDetails(workflow: RecordedWorkflow, options: { force?: boolean } = {}): void {
  if (options.force || !workflowNameInput.value) {
    workflowNameInput.value = workflow.meta.name ?? "";
  }
  if (options.force || workflowCategorySelect.value === "custom") {
    workflowCategorySelect.value = workflow.meta.category ?? "custom";
  }
}

async function syncWorkflow(): Promise<void> {
  const workflow = await buildWorkflow();
  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/api/workflows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, options: { compile: true, enableImmediately: true } })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Unknown error" }));
      setMessage(`Sync failed: ${body.error ?? response.statusText}`);
      return;
    }
    const result = await response.json();
    void chrome.tabs.create({ url: `${serverUrl}/#workflows` });
    setMessage(`Workflow synced. ID: ${result.id}`);
  } catch (error) {
    setMessage(`Sync failed: ${formatError(error)}`);
  }
}

async function buildWorkflow(): Promise<RecordedWorkflow> {
  const response = await sendMessage({ type: "BUILD_WORKFLOW" });
  const workflow = response?.workflow as RecordedWorkflow | undefined;
  if (!workflow) {
    throw new Error("Could not build workflow from the current recording.");
  }

  workflow.meta.name = workflowNameInput.value || currentWorkflow?.meta.name || "Untitled Workflow";
  workflow.meta.category = workflowCategorySelect.value as RecordedWorkflow["meta"]["category"];
  currentWorkflow = workflow;
  workflow.quality = calculateQualityReport(workflow.actions);
  return workflow;
}

function collectAllParameters(inputActions: RecordedAction[]): Array<{ actionId: string; paramIndex: number; hint: ParameterHint }> {
  const results: Array<{ actionId: string; paramIndex: number; hint: ParameterHint }> = [];
  const seen = new Set<string>();

  for (const action of inputActions) {
    if (!action.parameterHints) continue;
    for (let index = 0; index < action.parameterHints.length; index++) {
      const hint = action.parameterHints[index];
      if (seen.has(hint.suggestedName)) continue;
      seen.add(hint.suggestedName);
      results.push({ actionId: action.id, paramIndex: index, hint });
    }
  }

  return results;
}

function describeAction(action: RecordedAction): string {
  if (action.type === "navigate") return `Navigate to ${action.url ?? action.pageUrl}`;
  if (action.type === "fill") return `Fill ${action.selectors.label ?? "field"}`;
  if (action.type === "click") return `Click ${action.selectors.role?.name ?? action.selectors.text ?? "element"}`;
  if (action.type === "select") return `Select ${action.value ?? "option"}`;
  if (action.type === "press") return `Press ${action.key ?? "Enter"}`;
  if (action.type === "dismiss") return "Dismiss blocking popup";
  if (action.type === "screenshot") return `Take screenshot${action.screenshotLabel ? `: ${action.screenshotLabel}` : ""}`;
  if (action.type === "wait") return `Wait ${action.waitMs ?? 1_000}ms`;
  if (action.type === "upload") return "Upload file";
  return action.type;
}

function selectedAction(): RecordedAction | undefined {
  return actions.find((action) => action.id === selectedActionId);
}

function selectorConfidence(action: RecordedAction): SelectorConfidence {
  if (!isSelectorBased(action)) {
    return { level: "manual", reason: "Manual or page-level step" };
  }
  if (action.selectors.role?.name || action.selectors.testId) {
    return { level: "strong", reason: "Uses accessible role/name or test id" };
  }
  if (action.selectors.label || action.selectors.text) {
    return { level: "medium", reason: "Uses visible label or text" };
  }
  if (action.selectors.css) {
    return { level: "weak", reason: "Uses CSS fallback only" };
  }
  return { level: "weak", reason: "No usable selector captured" };
}

function hasUsableSelector(action: RecordedAction): boolean {
  const selectors = action.selectors;
  return Boolean(selectors.role || selectors.label || selectors.text || selectors.testId || selectors.css);
}

function isSelectorBased(action: RecordedAction): boolean {
  return !["navigate", "wait", "screenshot", "dismiss", "dialog", "if"].includes(action.type);
}

function isSubmitLikeClick(action: RecordedAction): boolean {
  if (action.type !== "click") return false;
  const label = action.selectors.role?.name ?? action.selectors.text ?? action.selectors.label ?? action.description ?? "";
  return isCommitClickLabel(label);
}

function formatSelectors(action: RecordedAction): string {
  const selectors = action.selectors;
  const parts = [
    selectors.role ? `role=${selectors.role.role}${selectors.role.name ? ` name="${selectors.role.name}"` : ""}` : undefined,
    selectors.label ? `label="${selectors.label}"` : undefined,
    selectors.text ? `text="${selectors.text}"` : undefined,
    selectors.testId ? `testId="${selectors.testId}"` : undefined,
    selectors.css ? `css="${selectors.css}"` : undefined,
    selectors.anchor?.text ? `anchor=${selectors.anchor.scopeRole ?? "row"} containing "${selectors.anchor.text}"` : undefined,
    action.selectorNote ? `note="${action.selectorNote}"` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "No selector required";
}

function calculateQualityReport(inputActions: RecordedAction[]): WorkflowQualityReport {
  const actionable = inputActions.filter((action) => !["navigate", "wait", "screenshot", "dismiss"].includes(action.type));
  const stableSelectors = actionable.filter((action) => action.selectors.role?.name || action.selectors.label || action.selectors.testId).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = inputActions.filter((action) => action.type === "click" && isCommitClickLabel(action.selectors.role?.name ?? action.selectors.text ?? ""));
  const assertionActions = inputActions.filter((action) => action.type === "assert");
  const assertionCoverage = submitActions.length === 0 ? 100 : Math.round((Math.min(assertionActions.length, submitActions.length) / submitActions.length) * 100);
  const evidenceCount = inputActions.filter((action) => action.type === "screenshot" || action.screenshotOnFailure || action.onFailure === "screenshot").length;
  const evidenceCoverage = inputActions.length === 0 ? 100 : Math.round((evidenceCount / inputActions.length) * 100);
  const riskySteps = inputActions.filter((action) => action.type === "click" && !action.selectors.role?.name && !action.selectors.testId).length;
  const hardcodedValues = inputActions.filter((action) => {
    const value = action.value ?? action.expected ?? "";
    return value.length > 0 && !value.includes("{{") && action.type !== "assert";
  }).length;
  const unsupportedBrowserPreflightSteps = inputActions.filter((action) => action.type === "upload").length;
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

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolbarIconSvg(icon: StepToolbarIcon): string {
  const icons: Record<StepToolbarIcon, string> = {
    navigate: '<svg viewBox="0 0 24 24"><path d="M5 19 19 5"></path><path d="M9 5h10v10"></path><path d="M5 19l5.5-1.5"></path></svg>',
    click: '<svg viewBox="0 0 24 24"><path d="m5 3 8 18 2-7 6-2L5 3Z"></path><path d="m13 13 5 5"></path></svg>',
    fill: '<svg viewBox="0 0 24 24"><path d="M8 5h8"></path><path d="M12 5v14"></path><path d="M9 19h6"></path></svg>',
    select: '<svg viewBox="0 0 24 24"><path d="M8 6h11"></path><path d="M8 12h11"></path><path d="M8 18h11"></path><path d="m3 12 1.5 1.5L7 10"></path></svg>',
    validate: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.3 2.8 7.2 7 8.5 4.2-1.3 7-4.2 7-8.5V6l-7-3Z"></path><path d="m8.5 12 2.2 2.2L15.8 9"></path></svg>',
    press: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h6"></path></svg>',
    screenshot: '<svg viewBox="0 0 24 24"><path d="M6.5 8.5h2l1.4-2h4.2l1.4 2h2A2.5 2.5 0 0 1 20 11v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5V11a2.5 2.5 0 0 1 2.5-2.5Z"></path><circle cx="12" cy="13.5" r="3"></circle></svg>',
    wait: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"></path><circle cx="12" cy="13" r="7"></circle><path d="M9 2h6"></path><path d="M12 2v3"></path></svg>',
    dismiss: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="m9 9 6 6"></path><path d="m15 9-6 6"></path></svg>'
  };
  return icons[icon];
}

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}
