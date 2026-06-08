import { isCommitClickLabel, scoreSelector, type AssertionType } from "@zoom-automation/workflow-core";
import { formatSelectorCandidateLabel, selectorCandidateScoreClass } from "../shared/selectorCandidateLabels.js";
import { applySelectorCandidate } from "../shared/selectorRepair.js";
import { buildStepInspectorSummary, fallbackCandidates } from "../shared/stepInspector.js";
import { assertionCatalog, assertionOptionsForUi, defaultAssertionInput } from "../shared/assertionCatalog.js";
import { createPublishReview } from "../shared/publishReview.js";
import { suggestParameterReplacements } from "../shared/authoringAssistants.js";
import {
  buildBulkPolicyUpdate,
  buildStepMiniMap,
  bulkPolicyTargets,
  describeStep,
  isSelectorBasedStep,
  isSubmitLikeClickStep,
  stepPolicyBadges,
  visibleFieldGroups,
  type BulkPolicyTarget,
  type InlineFieldGroup
} from "../shared/stepPresentation.js";
import type { ExtensionMessage, ParameterHint, RecordedAction, RecordedWorkflow, AnchorPickResult, SelectorPickResult, SelectorTestResult, WorkflowQualityReport, WorkflowTestEvent } from "../shared/types.js";

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

async function addAssertionStep(): Promise<void> {
  const defaults = defaultAssertionInput("textVisible");
  const response = await sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: defaults.assertionType,
    expected: defaults.expected ?? "",
    timeout: defaults.timeout,
    onFailure: defaults.onFailure,
    insertAfterActionId
  });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Validation step added. Configure it in the step.");
  await refreshState();
}

async function addClickStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_CLICK_ACTION", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Click step added. Add a stable selector in Selector details.");
  await refreshState();
}

async function addFillStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_FILL_ACTION", value: "", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Text entry step added. Configure the value and selector in the step.");
  await refreshState();
}

async function addSelectStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_SELECT_ACTION", value: "", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Select option step added. Configure the option and selector in the step.");
  await refreshState();
}

async function addPressStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_PRESS_ACTION", key: "Enter", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Key press step added. Configure the key in the step.");
  await refreshState();
}

async function addScreenshotStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_SCREENSHOT_ACTION", label: "evidence", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Screenshot step added. Configure it in the step.");
  await refreshState();
}

async function addWaitStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_WAIT_ACTION", waitMs: 1_000, insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Wait step added. Configure it in the step.");
  await refreshState();
}

async function addDismissStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_DISMISS_ACTION", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Dismiss popup step added.");
  await refreshState();
}

async function addNavigationStep(): Promise<void> {
  const response = await sendMessage({ type: "ADD_NAVIGATION_ACTION", url: "/", insertAfterActionId });
  selectAndExpandAction(response?.actionId);
  insertAfterActionId = undefined;
  setMessage("Navigation step added. Configure it in the step.");
  await refreshState();
}

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
  actionListEl.classList.toggle("compact", stepDensity === "compact");
  renderBulkTargetOptions();
  renderStepMiniMap();

  if (actions.length === 0) {
    actionListEl.appendChild(renderInsertRow(null));
    return;
  }

  const filteredActions = filteredStepEntries();
  if (filteredActions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact";
    empty.textContent = "No steps match the current filter.";
    actionListEl.appendChild(empty);
    return;
  }

  filteredActions.forEach(({ action, index }) => {
    const expanded = expandedActionIds.has(action.id);
    const item = document.createElement("article");
    item.className = `action-item${action.id === selectedActionId ? " selected" : ""}${action.id === testCurrentActionId ? " testing" : ""}${expanded ? " expanded" : ""}`;
    item.dataset.actionId = action.id;

    const header = document.createElement("div");
    header.className = "action-header";
    header.addEventListener("click", () => {
      selectedActionId = action.id;
      renderActions();
    });

    const main = document.createElement("div");
    main.className = "action-main";

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "action-expand";
    expand.title = expanded ? "Collapse step settings" : "Configure step";
    expand.setAttribute("aria-label", expanded ? "Collapse step settings" : "Configure step");
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = expanded ? "⌄" : "›";
    expand.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleActionExpanded(action.id);
    });

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
    const badges = renderStepBadges(action);
    if (badges) meta.appendChild(badges);

    const description = document.createElement("input");
    description.className = "action-description";
    description.type = "text";
    description.value = action.description ?? describeStep(action);
    description.addEventListener("blur", () => void updateActionDescription(action.id, description.value));
    description.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        description.blur();
      }
    });
    description.addEventListener("click", (event) => event.stopPropagation());

    body.append(meta, description);
    main.append(expand, indexEl, body);

    const controls = document.createElement("div");
    controls.className = "action-actions";
    controls.append(
      makeActionButton("Test", testRunning || recording, () => void testSingleStep(action)),
      makeActionButton("Up", index === 0, () => moveAction(action.id, "up")),
      makeActionButton("Down", index === actions.length - 1, () => moveAction(action.id, "down")),
      makeActionButton("Delete", false, () => deleteAction(action.id), "delete")
    );
    controls.addEventListener("click", (event) => event.stopPropagation());

    header.append(main, controls);
    item.appendChild(header);
    if (expanded) {
      item.appendChild(renderInlineStepEditor(action, confidence));
    }
    actionListEl.appendChild(item);
    if (!stepFilterText) {
      actionListEl.appendChild(renderInsertRow(action.id, index === actions.length - 1));
    }
  });
}

function renderStepMiniMap(): void {
  stepMiniMapEl.innerHTML = "";
  stepMiniMapEl.classList.toggle("hidden", actions.length === 0);
  if (actions.length === 0) return;

  for (const entry of buildStepMiniMap(actions, selectedActionId)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mini-map-step ${entry.level}${entry.active ? " active" : ""}${entry.actionId === testCurrentActionId ? " testing" : ""}`;
    button.textContent = String(entry.index);
    button.title = entry.title;
    button.setAttribute("aria-label", entry.title);
    button.addEventListener("click", () => jumpToStep(entry.actionId));
    stepMiniMapEl.appendChild(button);
  }
}

function jumpToStep(actionId: string): void {
  selectedActionId = actionId;
  expandedActionIds = new Set([actionId]);
  stepFilterInput.value = "";
  stepFilterText = "";
  renderActions();
  requestAnimationFrame(() => document.querySelector(`[data-action-id="${cssEscape(actionId)}"]`)?.scrollIntoView({ block: "center" }));
}

function filteredStepEntries(): Array<{ action: RecordedAction; index: number }> {
  return actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      if (!stepFilterText) return true;
      const haystack = [
        String(action.type),
        action.description,
        describeStep(action),
        action.value,
        action.expected,
        action.url,
        action.selectors.label,
        action.selectors.text,
        action.selectors.role?.name,
        action.selectorNote
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(stepFilterText);
    });
}

function toggleActionExpanded(actionId: string): void {
  selectedActionId = actionId;
  if (expandedActionIds.has(actionId)) {
    expandedActionIds.delete(actionId);
  } else {
    expandedActionIds = new Set([actionId]);
  }
  renderActions();
}

function renderStepBadges(action: RecordedAction): HTMLElement | undefined {
  const badges = stepPolicyBadges(action);
  if (badges.length === 0) return undefined;
  const wrapper = document.createElement("span");
  wrapper.className = "step-badges";
  for (const badge of badges) {
    const item = document.createElement("span");
    item.className = `step-badge ${badge.kind}`;
    item.title = badge.title;
    item.textContent = badge.label;
    wrapper.appendChild(item);
  }
  return wrapper;
}

function renderBulkTargetOptions(): void {
  const targets = currentBulkTargets();
  const selectedValue = bulkTargetSelect.value || "allSteps";
  bulkTargetSelect.innerHTML = "";
  for (const [value, target] of Object.entries(targets)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${target.label} (${target.actionIds.length})`;
    bulkTargetSelect.appendChild(option);
  }
  bulkTargetSelect.value = Object.hasOwn(targets, selectedValue) ? selectedValue : "allSteps";
}

function currentBulkTargets(): Record<keyof ReturnType<typeof bulkPolicyTargets>, BulkPolicyTarget> {
  return bulkPolicyTargets(actions);
}

function jumpToNextWeakStep(): void {
  const weakSteps = actions.filter((action) => selectorConfidence(action).level === "weak");
  if (weakSteps.length === 0) {
    setMessage("No weak selector steps found.");
    return;
  }
  const currentIndex = selectedActionId ? weakSteps.findIndex((action) => action.id === selectedActionId) : -1;
  const next = weakSteps[(currentIndex + 1 + weakSteps.length) % weakSteps.length];
  selectedActionId = next.id;
  expandedActionIds = new Set([next.id]);
  stepFilterInput.value = "";
  stepFilterText = "";
  renderActions();
  requestAnimationFrame(() => document.querySelector(`[data-action-id="${cssEscape(next.id)}"]`)?.scrollIntoView({ block: "center" }));
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

async function applyBulkPolicy(): Promise<void> {
  const targets = currentBulkTargets();
  const selected = targets[bulkTargetSelect.value as keyof typeof targets] ?? targets.allSteps;
  if (selected.actionIds.length === 0) {
    setMessage("No steps match the selected bulk target.");
    return;
  }

  const update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId"> = buildBulkPolicyUpdate({
    timeout: bulkTimeoutInput.value,
    retryCount: bulkRetryCountInput.value,
    retryDelayMs: bulkRetryDelayInput.value,
    enableContinueOnFailure: bulkContinueOnFailureInput.checked,
    enableScreenshotOnFailure: bulkScreenshotOnFailureInput.checked
  });

  for (const actionId of selected.actionIds) {
    await sendMessage({ type: "UPDATE_ACTION", actionId, ...update });
  }
  expandedActionIds = new Set(selected.actionIds.slice(0, 5));
  setMessage(`Bulk policy applied to ${selected.actionIds.length} step${selected.actionIds.length === 1 ? "" : "s"}.`);
  await refreshState();
}

function renderInlineStepEditor(action: RecordedAction, confidence: SelectorConfidence): HTMLElement {
  const editor = document.createElement("div");
  editor.className = "inline-step-editor";

  editor.appendChild(renderStepInspector(action));

  for (const group of visibleFieldGroups(action)) {
    const section = renderInlineFieldGroup(action, group, confidence);
    if (section) editor.appendChild(section);
  }

  return editor;
}

function renderStepInspector(action: RecordedAction): HTMLElement {
  const summary = buildStepInspectorSummary(action);
  const section = makeEditorSection("Inspector");
  section.classList.add("step-inspector");

  const top = document.createElement("div");
  top.className = "inspector-top";

  const thumb = document.createElement("div");
  thumb.className = `inspector-thumbnail${summary.hasThumbnail ? "" : " empty"}`;
  if (summary.thumbnail) {
    const image = document.createElement("img");
    image.src = summary.thumbnail.dataUrl;
    image.width = summary.thumbnail.width;
    image.height = summary.thumbnail.height;
    image.alt = "Recorded step screenshot";
    thumb.appendChild(image);
  } else {
    thumb.textContent = "No screenshot";
  }

  const facts = document.createElement("dl");
  facts.className = "inspector-facts";
  appendFact(facts, "Target", summary.targetPreview);
  appendFact(facts, "Chosen", summary.chosenSelectorLabel);
  appendFact(facts, "Anchor", summary.anchorLabel);
  appendFact(facts, "Context", summary.contextLabel);
  appendFact(facts, "Matches", summary.matchLabel);
  appendFact(facts, "Confidence", summary.confidenceLabel, `confidence-${summary.confidenceLevel}`);
  top.append(thumb, facts);

  const actionsRow = document.createElement("div");
  actionsRow.className = "inline-actions";
  actionsRow.append(
    makeActionButton("Highlight target", false, () => void highlightActionTarget(action)),
    makeActionButton("Refresh matches", false, () => void testSelectorForAction(action))
  );

  section.append(top, actionsRow, renderInspectorRepairs(action), renderInspectorFallbacks(action, summary.fallbackCount));
  return section;
}

function appendFact(list: HTMLDListElement, label: string, value: string, valueClass?: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  if (valueClass) detail.className = valueClass;
  detail.textContent = value;
  list.append(term, detail);
}

function renderInspectorFallbacks(action: RecordedAction, fallbackCount: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "inspector-fallbacks";
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = `Fallback selectors (${fallbackCount})`;
  wrapper.appendChild(title);

  const chosenId = action.selectorDiagnostics?.chosenCandidateId ?? action.selectedCandidateId;
  const candidates = fallbackCandidates(action.selectorCandidates ?? [], chosenId);
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No fallback selectors captured.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const list = document.createElement("div");
  list.className = "selector-candidates compact";
  for (const candidate of candidates.slice(0, 4)) {
    const item = document.createElement("div");
    item.className = "selector-candidate";
    const label = document.createElement("span");
    label.textContent = candidate.label ?? `${candidate.kind} selector`;
    const use = makeActionButton("Use", false, () => void useSelectorCandidate(action.id, candidate.selector));
    item.append(label, use);
    list.appendChild(item);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderInspectorRepairs(action: RecordedAction): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "inspector-fallbacks";
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = `Repair suggestions (${action.repairSuggestions?.length ?? 0})`;
  wrapper.appendChild(title);

  if (!action.repairSuggestions?.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Test this selector to generate repair suggestions.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const list = document.createElement("div");
  list.className = "selector-candidates compact";
  for (const suggestion of action.repairSuggestions.slice(0, 4)) {
    const item = document.createElement("div");
    item.className = `selector-candidate repair-${suggestion.risk}`;
    const label = document.createElement("span");
    label.textContent = `${suggestion.source} · ${suggestion.score.score}/100 · ${suggestion.risk} risk`;
    label.title = suggestion.score.reasons.join("; ");
    const use = makeActionButton("Apply", false, () => void useSelectorCandidate(action.id, suggestion.selector));
    item.append(label, use);
    list.appendChild(item);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderInlineFieldGroup(action: RecordedAction, group: InlineFieldGroup, confidence: SelectorConfidence): HTMLElement | undefined {
  if (group === "policy") return renderPolicyEditor(action);
  if (group === "test") return renderStepTestEditor(action);
  if (group === "selector") return renderSelectorEditor(action, confidence);
  if (group === "validationSuggestion") return renderValidationSuggestion(action);
  if (group === "value") return renderValueEditor(action);
  if (group === "key") return renderKeyEditor(action);
  if (group === "screenshot") return renderScreenshotEditor(action);
  if (group === "wait") return renderWaitEditor(action);
  if (group === "url") return renderUrlEditor(action);
  if (group === "assertion") return renderAssertionEditor(action);
  return undefined;
}

function renderPolicyEditor(action: RecordedAction): HTMLElement {
  const section = makeEditorSection("Step policy");

  const firstRow = document.createElement("div");
  firstRow.className = "two-column";
  firstRow.append(
    makeNumberField("Timeout", action.timeout ?? 10_000, { min: 500, max: 60_000, step: 500 }, (value) => updateActionPatch(action.id, { timeout: value || 10_000 })),
    makeNumberField("Retries", action.retryCount ?? 0, { min: 0, max: 10, step: 1 }, (value) => updateActionPatch(action.id, { retryCount: value || 0 }))
  );

  const secondRow = document.createElement("div");
  secondRow.className = "two-column";
  secondRow.append(
    makeNumberField("Retry delay", action.retryDelayMs ?? 1_000, { min: 0, max: 60_000, step: 250 }, (value) => updateActionPatch(action.id, { retryDelayMs: value || 1_000 })),
    makeConditionSelect(action)
  );

  const conditionText = makeTextField("Condition text", action.condition?.text ?? "", "Address text or status to check", (value) => updateConditionForAction(action, action.condition?.type ?? "none", value));

  const checkRow = document.createElement("div");
  checkRow.className = "check-row";
  checkRow.append(
    makeCheckbox("Continue on failure", Boolean(action.continueOnFailure), (checked) => updateActionPatch(action.id, { continueOnFailure: checked })),
    makeCheckbox("Screenshot on failure", Boolean(action.screenshotOnFailure), (checked) => updateActionPatch(action.id, { screenshotOnFailure: checked }))
  );

  section.append(firstRow, secondRow, conditionText, checkRow);
  return section;
}

function renderStepTestEditor(action: RecordedAction): HTMLElement {
  const section = makeEditorSection("Step test");
  const row = document.createElement("div");
  row.className = "inline-actions";
  row.append(
    makeActionButton("Test step", testRunning || recording, () => void testSingleStep(action)),
    makeActionButton("Test from here", testRunning || recording, () => void testWorkflowFromAction(action))
  );
  section.append(row, renderStepTestResult(action));
  return section;
}

function renderSelectorEditor(action: RecordedAction, confidence: SelectorConfidence): HTMLElement {
  const section = makeEditorSection(`Selector details: ${confidence.reason}`);
  const controls = document.createElement("div");
  controls.className = "selector-controls";
  controls.append(
    makeActionButton("Pick target", false, () => void pickSelectorForAction(action), "primary-action"),
    makeActionButton("Pick anchor", false, () => void pickAnchorForAction(action)),
    makeActionButton("Test selector", false, () => void testSelectorForAction(action))
  );
  section.append(controls, renderSelectorRepairFields(action, confidence), renderSelectorTestResult(action));
  return section;
}

function renderValidationSuggestion(action: RecordedAction): HTMLElement {
  const section = makeEditorSection("Validation");
  section.appendChild(makeActionButton("Add validation after this step", false, () => void addSuggestedValidationStep(action)));
  return section;
}

function renderValueEditor(action: RecordedAction): HTMLElement {
  const label = action.type === "fill" ? "Text" : "Option value";
  const placeholder = action.type === "fill" ? "Text to enter" : "Visible option text or value";
  return makeEditorSection("Value", makeTextField(label, action.value ?? "", placeholder, (value) => updateActionPatch(action.id, { value })));
}

function renderKeyEditor(action: RecordedAction): HTMLElement {
  const section = makeEditorSection("Key");
  const select = makeSelect(action.key ?? "Enter", [
    ["Enter", "Enter"],
    ["Tab", "Tab"],
    ["Escape", "Escape"],
    ["ArrowDown", "ArrowDown"],
    ["ArrowUp", "ArrowUp"],
    ["ArrowLeft", "ArrowLeft"],
    ["ArrowRight", "ArrowRight"],
    ["Space", "Space"]
  ], (value) => updateActionPatch(action.id, { key: value }));
  section.appendChild(select);
  return section;
}

function renderScreenshotEditor(action: RecordedAction): HTMLElement {
  return makeEditorSection("Screenshot", makeTextField("Screenshot label", action.screenshotLabel ?? "evidence", "after-save", (value) => updateActionPatch(action.id, { screenshotLabel: value })));
}

function renderWaitEditor(action: RecordedAction): HTMLElement {
  return makeEditorSection("Wait", makeNumberField("Milliseconds", action.waitMs ?? 1_000, { min: 250, max: 60_000, step: 250 }, (value) => updateActionPatch(action.id, { waitMs: value || 1_000 })));
}

function renderUrlEditor(action: RecordedAction): HTMLElement {
  return makeEditorSection("Navigation", makeTextField("URL or Zoom path", action.url ?? "", "/cpw/page/phoneNumbers#/business-address", (value) => updateActionPatch(action.id, { url: value })));
}

function renderAssertionEditor(action: RecordedAction): HTMLElement {
  const section = makeEditorSection("Assertion");
  const selectedType = action.assertionType ?? "textVisible";
  const selected = assertionCatalog[selectedType as keyof typeof assertionCatalog] ?? assertionCatalog.textVisible;
  section.append(
    makeLabeledSelect(
      "Assertion",
      selectedType,
      assertionOptionsForUi().map((option) => [option.value, option.label]),
      (value) => {
        const defaults = defaultAssertionInput(value as AssertionType);
        return updateActionPatch(action.id, {
          assertionType: defaults.assertionType,
          expected: action.expected || defaults.expected
        });
      }
    ),
    makeTextField("Expected value", action.expected ?? selected.defaultExpected, selected.placeholder, (value) => updateActionPatch(action.id, { expected: value }))
  );
  const row = document.createElement("div");
  row.className = "two-column";
  row.append(
    makeNumberField("Timeout", action.timeout ?? 10_000, { min: 500, max: 60_000, step: 500 }, (value) => updateActionPatch(action.id, { timeout: value || 10_000 })),
    makeLabeledSelect("On failure", action.onFailure ?? "screenshot", [
      ["screenshot", "Screenshot"],
      ["fail", "Fail"],
      ["retry", "Retry"],
      ["skip", "Skip"]
    ], (value) => updateActionPatch(action.id, { onFailure: value as RecordedAction["onFailure"] }))
  );
  section.appendChild(row);
  return section;
}

function renderSelectorRepairFields(action: RecordedAction, confidence: SelectorConfidence): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "selector-grid";

  const detail = document.createElement("div");
  detail.className = "selector-detail";
  detail.title = formatSelectors(action);
  detail.textContent = formatSelectors(action);

  const confidenceScore = scoreSelector(action.selectors);
  const confidenceDetail = document.createElement("div");
  confidenceDetail.className = "selector-confidence";
  confidenceDetail.textContent = `Confidence ${confidenceScore.score}/100: ${confidenceScore.reasons.join("; ") || confidence.reason}`;

  wrapper.append(
    detail,
    confidenceDetail,
    makeTextField("CSS fallback override", action.selectors.css ?? "", "[data-testid='save-button']", (value) => updateActionSelector(action.id, value, undefined)),
    makeTextField("Selector note", action.selectorNote ?? "", "Why this selector is stable or how to repair it", (value) => updateActionSelector(action.id, undefined, value))
  );
  return wrapper;
}

function makeEditorSection(title: string, child?: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.className = "inline-editor-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  if (child) section.appendChild(child);
  return section;
}

function makeConditionSelect(action: RecordedAction): HTMLElement {
  return makeLabeledSelect("Condition", action.condition?.type ?? "none", [
    ["none", "None"],
    ["textExistsSkip", "If text exists, skip"],
    ["elementVisibleClick", "If element visible, click"],
    ["fieldEmptyFill", "If field empty, fill"],
    ["addressAlreadyExistsSkipAccount", "If address exists, skip account"]
  ], (value) => updateConditionForAction(action, value as NonNullable<RecordedAction["condition"]>["type"], action.condition?.text ?? ""));
}

function makeTextField(labelText: string, value: string, placeholder: string, onCommit: (value: string) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("blur", () => void onCommit(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  const wrapper = document.createElement("div");
  wrapper.append(label, input);
  return wrapper;
}

function makeNumberField(labelText: string, value: number, range: { min: number; max: number; step: number }, onCommit: (value: number) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.addEventListener("blur", () => void onCommit(Number(input.value) || 0));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  const wrapper = document.createElement("div");
  wrapper.append(label, input);
  return wrapper;
}

function makeCheckbox(labelText: string, checked: boolean, onCommit: (checked: boolean) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "checkbox-control";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => void onCommit(input.checked));
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

function makeLabeledSelect(labelText: string, value: string, options: Array<[string, string]>, onCommit: (value: string) => Promise<void>): HTMLElement {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  wrapper.append(label, makeSelect(value, options, onCommit));
  return wrapper;
}

function makeSelect(value: string, options: Array<[string, string]>, onCommit: (value: string) => Promise<void>): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => void onCommit(select.value));
  return select;
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

function renderParameters(): void {
  parameterListEl.innerHTML = "";
  const parameters = collectAllParameters(actions);
  const suggestions = suggestParameterReplacements(actions);

  if (parameters.length === 0 && suggestions.length === 0) {
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

  for (const suggestion of suggestions.slice(0, 6)) {
    const item = document.createElement("div");
    item.className = "param-item";
    const text = document.createElement("div");
    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = suggestion.replacement;
    const value = document.createElement("span");
    value.className = "param-value";
    value.title = suggestion.originalValue;
    value.textContent = `Suggested from ${suggestion.originalValue}`;
    text.append(name, value);
    const buttons = document.createElement("div");
    buttons.className = "param-buttons";
    buttons.append(makeParamButton("Apply", false, () => void applyParameterSuggestion(suggestion)));
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
      expandedActionIds = new Set([action.id]);
      render();
      void addSuggestedValidationStep(action);
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

function renderSelectorTestResult(action: RecordedAction): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "selector-test-result";
  const result = selectorTestResults[action.id];
  if (!result) {
    wrapper.textContent = hasUsableSelector(action)
      ? "Test this selector against the current page."
      : "Pick the real page target to populate this step.";
    return wrapper;
  }
  if (result.error) {
    wrapper.textContent = `Selector test failed: ${result.error}`;
    wrapper.className = "selector-test-result error";
    return wrapper;
  }
  const summary = document.createElement("div");
  summary.className = "selector-test-summary";
  summary.innerHTML = `<strong>${result.visibleCount}/${result.matchedCount}</strong><span>visible / matched</span>`;
  wrapper.appendChild(summary);
  if (result.chosenPreview) {
    const preview = document.createElement("div");
    preview.className = "selector-preview";
    preview.textContent = `${result.chosenSelector ?? "Chosen"}: ${result.chosenPreview}`;
    wrapper.appendChild(preview);
  }
  if (result.fallbackCandidates.length > 0) {
    const list = document.createElement("div");
    list.className = "selector-candidates";
    for (const candidate of result.fallbackCandidates) {
      const item = document.createElement("div");
      item.className = "selector-candidate";
      const label = document.createElement("span");
      label.textContent = formatSelectorCandidateLabel(candidate);
      const score = document.createElement("span");
      score.className = selectorCandidateScoreClass(candidate.scoreLevel);
      score.textContent = candidate.score !== undefined ? String(candidate.score) : "—";
      const use = document.createElement("button");
      use.type = "button";
      use.className = "icon-button";
      use.textContent = "Use";
      use.disabled = candidate.visibleCount === 0;
      use.addEventListener("click", () => void useSelectorCandidate(action.id, candidate.selector));
      item.append(label, score, use);
      list.appendChild(item);
    }
    wrapper.appendChild(list);
  }
  return wrapper;
}

function renderStepTestResult(action: RecordedAction): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "selector-test-result";
  const result = stepTestResults[action.id];
  if (!result) {
    wrapper.textContent = "Test only this step against the current page.";
    return wrapper;
  }
  wrapper.classList.toggle("error", result.level === "error");
  wrapper.textContent = result.message;
  return wrapper;
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

async function updateActionPatch(actionId: string, update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId">): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, ...update });
  await refreshState();
}

async function updateActionSelector(actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, cssSelector, selectorNote });
  await refreshState();
}

async function updateConditionForAction(action: RecordedAction, type: NonNullable<RecordedAction["condition"]>["type"], text: string): Promise<void> {
  await updateActionPatch(action.id, {
    condition: {
      type,
      text: text.trim() || undefined,
      selector: action.selectors
    }
  });
}

async function testSelectorForAction(action: RecordedAction): Promise<void> {
  selectedActionId = action.id;
  expandedActionIds = new Set([action.id]);
  setMessage("Testing selector in the active page...");
  const result = await sendMessage({ type: "TEST_SELECTOR", action }) as SelectorTestResult;
  selectorTestResults = { ...selectorTestResults, [action.id]: result };
  if (!result.error) {
    await sendMessage({
      type: "UPDATE_ACTION",
      actionId: action.id,
      selectorDiagnostics: result.selectorDiagnostics,
      repairSuggestions: result.repairSuggestions
    });
  }
  render();
}

async function highlightActionTarget(action: RecordedAction): Promise<void> {
  const response = await sendMessage({ type: "HIGHLIGHT_ACTION_TARGET", action });
  if (!response?.ok) {
    setMessage(response?.error ?? "Could not highlight this step on the current page.");
    return;
  }
  setMessage("Target highlighted in the active tab.");
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

async function pickSelectorForAction(action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "selectRows", "press", "assert"].includes(action.type)) {
    setMessage("This step does not need a page target.");
    return;
  }

  selectedActionId = action.id;
  expandedActionIds = new Set([action.id]);
  setMessage("Click the target element in the active Zoom tab. Press Esc to cancel.");
  const result = await sendMessage({ type: "PICK_SELECTOR", action }) as SelectorPickResult;
  if (result.error) {
    selectorTestResults = {
      ...selectorTestResults,
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error }
    };
    setMessage(result.error);
    render();
    return;
  }

  const update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId"> = {
    selectors: result.selectors,
    selectorCandidates: result.selectorCandidates,
    selectedCandidateId: result.selectedCandidateId,
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

async function pickAnchorForAction(action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "selectRows", "press"].includes(action.type)) {
    setMessage("This step does not need an anchor.");
    return;
  }
  if (!hasUsableSelector(action)) {
    setMessage("Pick a target before adding an anchor.");
    return;
  }

  selectedActionId = action.id;
  expandedActionIds = new Set([action.id]);
  setMessage("Click stable label, row, dialog, or section text in the active Zoom tab. Press Esc to cancel.");
  const result = await sendMessage({ type: "PICK_ANCHOR", action }) as AnchorPickResult;
  if (result.error || !result.anchor) {
    selectorTestResults = {
      ...selectorTestResults,
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error ?? "No anchor was selected." }
    };
    setMessage(result.error ?? "No anchor was selected.");
    render();
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
  const selectors = action ? applySelectorCandidate(action.selectors, selector) : selector;
  await updateActionPatch(actionId, { selectors });
  setMessage("Selector candidate applied.");
}

async function addSuggestedValidationStep(actionOverride?: RecordedAction): Promise<void> {
  const action = actionOverride ?? selectedAction();
  if (!action || !isSubmitLikeClick(action)) return;

  const response = await sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: "textVisible",
    expected: "success|saved|added|submitted",
    timeout: 10_000,
    onFailure: "screenshot",
    insertAfterActionId: action.id
  });
  selectAndExpandAction(response?.actionId);
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

async function applyParameterSuggestion(suggestion: ReturnType<typeof suggestParameterReplacements>[number]): Promise<void> {
  const update = suggestion.field === "value"
    ? { value: suggestion.replacement }
    : { expected: suggestion.replacement };
  await updateActionPatch(suggestion.actionId, update);
  setMessage(`Applied parameter ${suggestion.replacement}.`);
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
    const review = createPublishReview({ quality: workflow.quality ?? calculateQualityReport(workflow.actions), warningsAccepted: false });
    if (!review.publishable) {
      const ok = confirm(`Workflow quality warnings:\n\n${review.warnings.join("\n")}\n\nPublish anyway?`);
      if (!ok) {
        setMessage("Sync cancelled. Review workflow quality warnings first.");
        return;
      }
    }
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
  return isSelectorBasedStep(action);
}

function isSubmitLikeClick(action: RecordedAction): boolean {
  return isSubmitLikeClickStep(action);
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
