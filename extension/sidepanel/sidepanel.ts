import type { ExtensionMessage, ParameterHint, RecordedAction, RecordedWorkflow, SelectorTestResult, WorkflowQualityReport, WorkflowTestEvent } from "../shared/types.js";

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

const btnStart = mustGet("btn-start") as HTMLButtonElement;
const btnPause = mustGet("btn-pause") as HTMLButtonElement;
const btnStop = mustGet("btn-stop") as HTMLButtonElement;
const btnClear = mustGet("btn-clear") as HTMLButtonElement;
const btnAddNavigation = mustGet("btn-add-navigation") as HTMLButtonElement;
const btnAddAssertion = mustGet("btn-add-assertion") as HTMLButtonElement;
const btnAddScreenshot = mustGet("btn-add-screenshot") as HTMLButtonElement;
const btnAddWait = mustGet("btn-add-wait") as HTMLButtonElement;
const btnCopy = mustGet("btn-copy") as HTMLButtonElement;
const btnDownload = mustGet("btn-download") as HTMLButtonElement;
const btnSync = mustGet("btn-sync") as HTMLButtonElement;
const btnTestWorkflow = mustGet("btn-test-workflow") as HTMLButtonElement;
const btnTestSelector = mustGet("btn-test-selector") as HTMLButtonElement;

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

interface SelectorConfidence {
  level: "strong" | "medium" | "weak" | "manual";
  reason: string;
}

void init();

async function init(): Promise<void> {
  await refreshState();
  wireEvents();
}

function wireEvents(): void {
  btnStart.addEventListener("click", () => void startRecording());
  btnPause.addEventListener("click", () => void togglePause());
  btnStop.addEventListener("click", () => void stopRecording());
  btnClear.addEventListener("click", () => void clearActions());
  btnAddNavigation.addEventListener("click", () => void addToolbarStep(addNavigationStep));
  btnAddAssertion.addEventListener("click", () => void addToolbarStep(addAssertionStep));
  btnAddScreenshot.addEventListener("click", () => void addToolbarStep(addScreenshotStep));
  btnAddWait.addEventListener("click", () => void addToolbarStep(addWaitStep));
  wireInspectorEvents();

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

  stepTimeoutInput.addEventListener("blur", () => void updateSelectedAction({ timeout: Number(stepTimeoutInput.value) || 10_000 }));
  stepRetryCountInput.addEventListener("blur", () => void updateSelectedAction({ retryCount: Number(stepRetryCountInput.value) || 0 }));
  stepRetryDelayInput.addEventListener("blur", () => void updateSelectedAction({ retryDelayMs: Number(stepRetryDelayInput.value) || 1_000 }));
  stepContinueOnFailureInput.addEventListener("change", () => void updateSelectedAction({ continueOnFailure: stepContinueOnFailureInput.checked }));
  stepScreenshotOnFailureInput.addEventListener("change", () => void updateSelectedAction({ screenshotOnFailure: stepScreenshotOnFailureInput.checked }));
  stepConditionSelect.addEventListener("change", () => void updateCondition());
  stepConditionTextInput.addEventListener("blur", () => void updateCondition());
  btnTestSelector.addEventListener("click", () => void testSelectedSelector());
}

async function refreshState(): Promise<void> {
  const status = await sendMessage({ type: "GET_STATUS" });
  const actionResponse = await sendMessage({ type: "GET_ACTIONS" });
  const testResponse = await sendMessage({ type: "GET_TEST_WORKFLOW_STATE" });
  recording = Boolean(status?.recording);
  paused = Boolean(status?.paused);
  actions = actionResponse?.actions ?? [];
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
      makeInsertTool("↗", "Navigate", () => void addNavigationStep()),
      makeInsertTool("✓", "Validate", () => void addAssertionStep()),
      makeInsertTool("▣", "Shot", () => void addScreenshotStep()),
      makeInsertTool("⏱", "Wait", () => void addWaitStep())
    );
    row.appendChild(tools);
  }

  return row;
}

function makeInsertTool(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "insert-tool";
  button.title = label;
  button.textContent = `${icon} ${label}`;
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
  stepTimeoutInput.value = String(action.timeout ?? 10_000);
  stepRetryCountInput.value = String(action.retryCount ?? 0);
  stepRetryDelayInput.value = String(action.retryDelayMs ?? 1_000);
  stepContinueOnFailureInput.checked = Boolean(action.continueOnFailure);
  stepScreenshotOnFailureInput.checked = Boolean(action.screenshotOnFailure);
  stepConditionSelect.value = action.condition?.type ?? "none";
  stepConditionTextInput.value = action.condition?.text ?? "";

  const selectorBased = !["navigate", "wait", "assert", "screenshot", "dismiss"].includes(action.type);
  togglePropertyField("field-selector-test", selectorBased);
  togglePropertyField("field-url", action.type === "navigate");
  togglePropertyField("field-assertion", action.type === "assert");
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
  if (action.type === "screenshot") {
    screenshotLabelInput.value = action.screenshotLabel ?? "evidence";
  }
  if (action.type === "wait") {
    waitMsInput.value = String(action.waitMs ?? 1_000);
  }
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

  grid.append(detail, cssLabel, cssInput, noteLabel, noteInput);
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
    selectorTestResultEl.textContent = "Test this selector against the current page.";
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
      item.textContent = `${candidate.label}: ${candidate.visibleCount}/${candidate.matchedCount} visible`;
      list.appendChild(item);
    }
    selectorTestResultEl.appendChild(list);
  }
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
  await sendMessage({ type: "UPDATE_ACTION", actionId: selectedActionId, ...update });
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
  if (action.type === "upload") return "Upload file";
  return action.type;
}

function selectedAction(): RecordedAction | undefined {
  return actions.find((action) => action.id === selectedActionId);
}

function selectorConfidence(action: RecordedAction): SelectorConfidence {
  if (["navigate", "wait", "assert", "screenshot", "dismiss"].includes(action.type)) {
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

function formatSelectors(action: RecordedAction): string {
  const selectors = action.selectors;
  const parts = [
    selectors.role ? `role=${selectors.role.role}${selectors.role.name ? ` name="${selectors.role.name}"` : ""}` : undefined,
    selectors.label ? `label="${selectors.label}"` : undefined,
    selectors.text ? `text="${selectors.text}"` : undefined,
    selectors.testId ? `testId="${selectors.testId}"` : undefined,
    selectors.css ? `css="${selectors.css}"` : undefined,
    action.selectorNote ? `note="${action.selectorNote}"` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "No selector required";
}

function calculateQualityReport(inputActions: RecordedAction[]): WorkflowQualityReport {
  const actionable = inputActions.filter((action) => !["navigate", "wait", "screenshot", "dismiss"].includes(action.type));
  const stableSelectors = actionable.filter((action) => action.selectors.role?.name || action.selectors.label || action.selectors.testId).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = inputActions.filter((action) => action.type === "click" && /save|submit|add|continue|confirm/i.test(action.selectors.role?.name ?? action.selectors.text ?? ""));
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

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}
