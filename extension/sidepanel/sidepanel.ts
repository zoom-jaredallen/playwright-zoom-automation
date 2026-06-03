import type { ExtensionMessage, ParameterHint, RecordedAction, RecordedWorkflow } from "../shared/types.js";

const recordingStateEl = mustGet("recording-state");
const statusPillEl = mustGet("status-pill");
const actionListEl = mustGet("action-list");
const emptyActionsEl = mustGet("empty-actions");
const stepSummaryEl = mustGet("step-summary");
const parameterListEl = mustGet("parameter-list");
const messageEl = mustGet("message");

const workflowNameInput = mustGet("workflow-name") as HTMLInputElement;
const workflowCategorySelect = mustGet("workflow-category") as HTMLSelectElement;
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

let recording = false;
let paused = false;
let actions: RecordedAction[] = [];
let currentWorkflow: RecordedWorkflow | undefined;

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
  btnAddNavigation.addEventListener("click", () => void addNavigationStep());
  btnAddAssertion.addEventListener("click", () => void addAssertionStep());
  btnAddScreenshot.addEventListener("click", () => void addScreenshotStep());
  btnAddWait.addEventListener("click", () => void addWaitStep());
  manualUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void addNavigationStep();
    }
  });

  btnCopy.addEventListener("click", () => void copyWorkflow());
  btnDownload.addEventListener("click", () => void downloadWorkflow());
  btnSync.addEventListener("click", () => void syncWorkflow());

  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === "RECORDER_STATE_UPDATED") {
      recording = message.recording;
      paused = message.paused;
      actions = message.actions;
      render();
    }
  });
}

async function refreshState(): Promise<void> {
  const status = await sendMessage({ type: "GET_STATUS" });
  const actionResponse = await sendMessage({ type: "GET_ACTIONS" });
  recording = Boolean(status?.recording);
  paused = Boolean(status?.paused);
  actions = actionResponse?.actions ?? [];
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
  const expected = assertExpectedInput.value.trim();
  if (!expected) {
    setMessage("Enter a value to validate before adding an assertion.");
    return;
  }

  await sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: assertTypeSelect.value as RecordedAction["assertionType"],
    expected,
    timeout: Number(assertTimeoutInput.value) || 10_000,
    onFailure: assertOnFailureSelect.value as RecordedAction["onFailure"]
  });
  assertExpectedInput.value = "";
  setMessage("Assertion step added.");
  await refreshState();
}

async function addScreenshotStep(): Promise<void> {
  await sendMessage({ type: "ADD_SCREENSHOT_ACTION", label: screenshotLabelInput.value });
  screenshotLabelInput.value = "";
  setMessage("Screenshot step added.");
  await refreshState();
}

async function addWaitStep(): Promise<void> {
  await sendMessage({ type: "ADD_WAIT_ACTION", waitMs: Number(waitMsInput.value) || 1_000 });
  setMessage("Wait step added.");
  await refreshState();
}

async function addNavigationStep(): Promise<void> {
  const url = manualUrlInput.value.trim();
  if (!url) {
    setMessage("Enter a URL or Zoom path before adding a navigation step.");
    return;
  }

  await sendMessage({ type: "ADD_NAVIGATION_ACTION", url });
  manualUrlInput.value = "";
  setMessage("Navigation step added.");
  await refreshState();
}

function render(): void {
  renderStatus();
  renderActions();
  renderParameters();
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

  actions.forEach((action, index) => {
    const item = document.createElement("article");
    item.className = "action-item";

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
  });
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

async function updateActionSelector(actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void> {
  await sendMessage({ type: "UPDATE_ACTION", actionId, cssSelector, selectorNote });
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
