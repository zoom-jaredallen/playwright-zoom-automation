import { formatSelectorCandidateLabel, selectorCandidateScoreClass } from "../shared/selectorCandidateLabels.js";
import { suggestParameterReplacements } from "../shared/authoringAssistants.js";
import type { RecordedAction, SelectorTestResult, WorkflowTestEvent } from "../shared/types.js";
import { calculateQualityReport, hasUsableSelector, isSelectorBased, isSubmitLikeClick } from "./qualityUtils.js";
import { makeParamButton, makeRepairButton } from "./uiControls.js";

export function renderParametersPanel(input: {
  parameterListEl: HTMLElement;
  actions: RecordedAction[];
  collectAllParameters: (actions: RecordedAction[]) => Array<{ actionId: string; paramIndex: number; hint: any }>;
  updateParameter(actionId: string, paramIndex: number, confirmed: boolean): Promise<void>;
  applyParameterSuggestion(suggestion: ReturnType<typeof suggestParameterReplacements>[number]): Promise<void>;
}): void {
  const { parameterListEl, actions } = input;
  parameterListEl.innerHTML = "";
  const parameters = input.collectAllParameters(actions);
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
      makeParamButton("Param", hint.confirmed !== false, () => input.updateParameter(actionId, paramIndex, true)),
      makeParamButton("Literal", hint.confirmed === false, () => input.updateParameter(actionId, paramIndex, false))
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
    buttons.append(makeParamButton("Apply", false, () => void input.applyParameterSuggestion(suggestion)));
    item.append(text, buttons);
    parameterListEl.appendChild(item);
  }
}

export function renderTestStatePanel(input: {
  btnTestWorkflow: HTMLButtonElement;
  testSummaryEl: HTMLElement;
  testEventsEl: HTMLElement;
  testRunning: boolean;
  recording: boolean;
  testEvents: WorkflowTestEvent[];
  actions: RecordedAction[];
  repairDeps: RepairActionDeps;
}): void {
  input.btnTestWorkflow.disabled = input.testRunning || input.recording;
  input.btnTestWorkflow.textContent = input.testRunning ? "Testing" : "Test";
  input.testSummaryEl.textContent = input.testRunning
    ? "Testing workflow in the active tab..."
    : "Run the current workflow in this browser tab.";

  input.testEventsEl.innerHTML = "";
  for (const event of input.testEvents.slice(-8)) {
    const item = document.createElement("div");
    item.className = `test-event ${event.level}`;
    item.textContent = `${new Date(event.timestamp).toLocaleTimeString()} ${event.message}`;
    input.testEventsEl.appendChild(item);
  }

  const failedEvent = [...input.testEvents].reverse().find((event) => event.level === "error" && event.actionId);
  const failedAction = failedEvent?.actionId ? input.actions.find((action) => action.id === failedEvent.actionId) : undefined;
  if (failedAction) {
    input.testEventsEl.appendChild(renderRepairActions(failedAction, input.repairDeps));
  }
}

export interface RepairActionDeps {
  selectAction(actionId: string): void;
  render(): void;
  pickSelectorForAction(action: RecordedAction): Promise<void>;
  pickAnchorForAction(action: RecordedAction): Promise<void>;
  increaseStepTimeout(action: RecordedAction): Promise<void>;
  addSuggestedValidationStep(action: RecordedAction): Promise<void>;
  updateActionPatch(actionId: string, update: Partial<RecordedAction>): Promise<void>;
}

function renderRepairActions(action: RecordedAction, deps: RepairActionDeps): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "repair-actions";

  wrapper.appendChild(makeRepairButton("Select step", () => {
    deps.selectAction(action.id);
    deps.render();
  }));

  if (isSelectorBased(action)) {
    wrapper.appendChild(makeRepairButton("Re-pick target", () => {
      deps.selectAction(action.id);
      deps.render();
      void deps.pickSelectorForAction(action);
    }));
    wrapper.appendChild(makeRepairButton("Pick anchor", () => {
      deps.selectAction(action.id);
      deps.render();
      void deps.pickAnchorForAction(action);
    }));
  }

  wrapper.appendChild(makeRepairButton("Increase timeout", () => void deps.increaseStepTimeout(action)));

  if (isSubmitLikeClick(action)) {
    wrapper.appendChild(makeRepairButton("Add validation", () => {
      deps.selectAction(action.id);
      deps.render();
      void deps.addSuggestedValidationStep(action);
    }));
  }

  wrapper.appendChild(makeRepairButton("Continue on fail", () => void deps.updateActionPatch(action.id, { continueOnFailure: true, screenshotOnFailure: true })));
  return wrapper;
}

export function renderQualityReportPanel(input: {
  actions: RecordedAction[];
  qualityScoreEl: HTMLElement;
  qualityReportEl: HTMLElement;
}): void {
  const report = calculateQualityReport(input.actions);
  input.qualityScoreEl.textContent = `${report.score}`;
  input.qualityScoreEl.className = `quality-score ${report.score >= 80 ? "good" : report.score >= 60 ? "warn" : "bad"}`;
  input.qualityReportEl.innerHTML = "";

  const metrics = [
    ["Selector stability", report.selectorStability],
    ["Assertion coverage", report.assertionCoverage],
    ["Evidence coverage", report.evidenceCoverage]
  ] as const;

  for (const [label, value] of metrics) {
    const row = document.createElement("div");
    row.className = "quality-row";
    row.innerHTML = `<span>${label}</span><strong>${value}%</strong>`;
    input.qualityReportEl.appendChild(row);
  }

  const risk = document.createElement("div");
  risk.className = "quality-risk-grid";
  risk.innerHTML = `
    <span>Risky steps <strong>${report.riskySteps}</strong></span>
    <span>Hardcoded values <strong>${report.hardcodedValues}</strong></span>
    <span>Unsupported test steps <strong>${report.unsupportedBrowserPreflightSteps}</strong></span>
  `;
  input.qualityReportEl.appendChild(risk);

  if (report.warnings.length > 0) {
    const list = document.createElement("ul");
    list.className = "quality-warnings";
    for (const warning of report.warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.appendChild(item);
    }
    input.qualityReportEl.appendChild(list);
  }
}

export function renderSelectorTestResultPanel(
  action: RecordedAction,
  selectorTestResults: Record<string, SelectorTestResult>,
  useSelectorCandidate: (actionId: string, selector: RecordedAction["selectors"]) => Promise<void>
): HTMLElement {
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
      score.textContent = candidate.score !== undefined ? String(candidate.score) : "-";
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

export function renderStepTestResultPanel(action: RecordedAction, stepTestResults: Record<string, { level: "success" | "error" | "info"; message: string }>): HTMLElement {
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
