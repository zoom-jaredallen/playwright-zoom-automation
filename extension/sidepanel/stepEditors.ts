import { scoreSelector, type AssertionType } from "@zoom-automation/workflow-core";
import { buildStepInspectorSummary, fallbackCandidates } from "../shared/stepInspector.js";
import { assertionCatalog, assertionOptionsForUi, defaultAssertionInput } from "../shared/assertionCatalog.js";
import { visibleFieldGroups, type InlineFieldGroup } from "../shared/stepPresentation.js";
import type { RecordedAction } from "../shared/types.js";
import type { SelectorConfidence } from "./qualityUtils.js";
import { formatSelectors } from "./qualityUtils.js";
import {
  makeActionButton,
  makeCheckbox,
  makeEditorSection,
  makeLabeledSelect,
  makeNumberField,
  makeSelect,
  makeTextField
} from "./uiControls.js";

export interface StepEditorDeps {
  recording: boolean;
  testRunning: boolean;
  addSuggestedValidationStep(actionOverride?: RecordedAction): Promise<void>;
  highlightActionTarget(action: RecordedAction): Promise<void>;
  pickAnchorForAction(action: RecordedAction): Promise<void>;
  pickSelectorForAction(action: RecordedAction): Promise<void>;
  renderSelectorTestResult(action: RecordedAction): HTMLElement;
  renderStepTestResult(action: RecordedAction): HTMLElement;
  testSelectorForAction(action: RecordedAction): Promise<void>;
  testSingleStep(action: RecordedAction): Promise<void>;
  testWorkflowFromAction(action: RecordedAction): Promise<void>;
  updateActionPatch(actionId: string, update: Partial<RecordedAction>): Promise<void>;
  updateActionSelector(actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void>;
  updateConditionForAction(action: RecordedAction, type: NonNullable<RecordedAction["condition"]>["type"], text: string): Promise<void>;
  useSelectorCandidate(actionId: string, selector: RecordedAction["selectors"]): Promise<void>;
}

export function renderInlineStepEditor(action: RecordedAction, confidence: SelectorConfidence, deps: StepEditorDeps): HTMLElement {
  const editor = document.createElement("div");
  editor.className = "inline-step-editor";

  editor.appendChild(renderStepInspector(action, deps));

  for (const group of visibleFieldGroups(action)) {
    const section = renderInlineFieldGroup(action, group, confidence, deps);
    if (section) editor.appendChild(section);
  }

  return editor;
}

function renderStepInspector(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
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
    makeActionButton("Highlight target", false, () => void deps.highlightActionTarget(action)),
    makeActionButton("Refresh matches", false, () => void deps.testSelectorForAction(action))
  );

  section.append(top, actionsRow, renderInspectorRepairs(action, deps), renderInspectorFallbacks(action, summary.fallbackCount, deps));
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

function renderInspectorFallbacks(action: RecordedAction, fallbackCount: number, deps: StepEditorDeps): HTMLElement {
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
    const use = makeActionButton("Use", false, () => void deps.useSelectorCandidate(action.id, candidate.selector));
    item.append(label, use);
    list.appendChild(item);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderInspectorRepairs(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
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
    const use = makeActionButton("Apply", false, () => void deps.useSelectorCandidate(action.id, suggestion.selector));
    item.append(label, use);
    list.appendChild(item);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderInlineFieldGroup(action: RecordedAction, group: InlineFieldGroup, confidence: SelectorConfidence, deps: StepEditorDeps): HTMLElement | undefined {
  if (group === "policy") return renderPolicyEditor(action, deps);
  if (group === "test") return renderStepTestEditor(action, deps);
  if (group === "selector") return renderSelectorEditor(action, confidence, deps);
  if (group === "validationSuggestion") return renderValidationSuggestion(action, deps);
  if (group === "value") return renderValueEditor(action, deps);
  if (group === "key") return renderKeyEditor(action, deps);
  if (group === "screenshot") return renderScreenshotEditor(action, deps);
  if (group === "wait") return renderWaitEditor(action, deps);
  if (group === "url") return renderUrlEditor(action, deps);
  if (group === "assertion") return renderAssertionEditor(action, deps);
  return undefined;
}

function renderPolicyEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  const section = makeEditorSection("Step policy");

  const firstRow = document.createElement("div");
  firstRow.className = "two-column";
  firstRow.append(
    makeNumberField("Timeout", action.timeout ?? 10_000, { min: 500, max: 60_000, step: 500 }, (value) => deps.updateActionPatch(action.id, { timeout: value || 10_000 })),
    makeNumberField("Retries", action.retryCount ?? 0, { min: 0, max: 10, step: 1 }, (value) => deps.updateActionPatch(action.id, { retryCount: value || 0 }))
  );

  const secondRow = document.createElement("div");
  secondRow.className = "two-column";
  secondRow.append(
    makeNumberField("Retry delay", action.retryDelayMs ?? 1_000, { min: 0, max: 60_000, step: 250 }, (value) => deps.updateActionPatch(action.id, { retryDelayMs: value || 1_000 })),
    makeConditionSelect(action, deps)
  );

  const conditionText = makeTextField("Condition text", action.condition?.text ?? "", "Address text or status to check", (value) => deps.updateConditionForAction(action, action.condition?.type ?? "none", value));

  const checkRow = document.createElement("div");
  checkRow.className = "check-row";
  checkRow.append(
    makeCheckbox("Continue on failure", Boolean(action.continueOnFailure), (checked) => deps.updateActionPatch(action.id, { continueOnFailure: checked })),
    makeCheckbox("Screenshot on failure", Boolean(action.screenshotOnFailure), (checked) => deps.updateActionPatch(action.id, { screenshotOnFailure: checked }))
  );

  section.append(firstRow, secondRow, conditionText, checkRow);
  return section;
}

function renderStepTestEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  const section = makeEditorSection("Step test");
  const row = document.createElement("div");
  row.className = "inline-actions";
  row.append(
    makeActionButton("Test step", deps.testRunning || deps.recording, () => void deps.testSingleStep(action)),
    makeActionButton("Test from here", deps.testRunning || deps.recording, () => void deps.testWorkflowFromAction(action))
  );
  section.append(row, deps.renderStepTestResult(action));
  return section;
}

function renderSelectorEditor(action: RecordedAction, confidence: SelectorConfidence, deps: StepEditorDeps): HTMLElement {
  const section = makeEditorSection(`Selector details: ${confidence.reason}`);
  const controls = document.createElement("div");
  controls.className = "selector-controls";
  controls.append(
    makeActionButton("Pick target", false, () => void deps.pickSelectorForAction(action), "primary-action"),
    makeActionButton("Pick anchor", false, () => void deps.pickAnchorForAction(action)),
    makeActionButton("Test selector", false, () => void deps.testSelectorForAction(action))
  );
  section.append(controls, renderSelectorRepairFields(action, confidence, deps), deps.renderSelectorTestResult(action));
  return section;
}

function renderValidationSuggestion(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  const section = makeEditorSection("Validation");
  section.appendChild(makeActionButton("Add validation after this step", false, () => void deps.addSuggestedValidationStep(action)));
  return section;
}

function renderValueEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  const label = action.type === "fill" ? "Text" : "Option value";
  const placeholder = action.type === "fill" ? "Text to enter" : "Visible option text or value";
  return makeEditorSection("Value", makeTextField(label, action.value ?? "", placeholder, (value) => deps.updateActionPatch(action.id, { value })));
}

function renderKeyEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
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
  ], (value) => deps.updateActionPatch(action.id, { key: value }));
  section.appendChild(select);
  return section;
}

function renderScreenshotEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  return makeEditorSection("Screenshot", makeTextField("Screenshot label", action.screenshotLabel ?? "evidence", "after-save", (value) => deps.updateActionPatch(action.id, { screenshotLabel: value })));
}

function renderWaitEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  return makeEditorSection("Wait", makeNumberField("Milliseconds", action.waitMs ?? 1_000, { min: 250, max: 60_000, step: 250 }, (value) => deps.updateActionPatch(action.id, { waitMs: value || 1_000 })));
}

function renderUrlEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  return makeEditorSection("Navigation", makeTextField("URL or Zoom path", action.url ?? "", "/cpw/page/phoneNumbers#/business-address", (value) => deps.updateActionPatch(action.id, { url: value })));
}

function renderAssertionEditor(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
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
        return deps.updateActionPatch(action.id, {
          assertionType: defaults.assertionType,
          expected: action.expected || defaults.expected
        });
      }
    ),
    makeTextField("Expected value", action.expected ?? selected.defaultExpected, selected.placeholder, (value) => deps.updateActionPatch(action.id, { expected: value }))
  );
  const row = document.createElement("div");
  row.className = "two-column";
  row.append(
    makeNumberField("Timeout", action.timeout ?? 10_000, { min: 500, max: 60_000, step: 500 }, (value) => deps.updateActionPatch(action.id, { timeout: value || 10_000 })),
    makeLabeledSelect("On failure", action.onFailure ?? "screenshot", [
      ["screenshot", "Screenshot"],
      ["fail", "Fail"],
      ["retry", "Retry"],
      ["skip", "Skip"]
    ], (value) => deps.updateActionPatch(action.id, { onFailure: value as RecordedAction["onFailure"] }))
  );
  section.appendChild(row);
  return section;
}

function renderSelectorRepairFields(action: RecordedAction, confidence: SelectorConfidence, deps: StepEditorDeps): HTMLElement {
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
    makeTextField("CSS fallback override", action.selectors.css ?? "", "[data-testid='save-button']", (value) => deps.updateActionSelector(action.id, value, undefined)),
    makeTextField("Selector note", action.selectorNote ?? "", "Why this selector is stable or how to repair it", (value) => deps.updateActionSelector(action.id, undefined, value))
  );
  return wrapper;
}

function makeConditionSelect(action: RecordedAction, deps: StepEditorDeps): HTMLElement {
  return makeLabeledSelect("Condition", action.condition?.type ?? "none", [
    ["none", "None"],
    ["textExistsSkip", "If text exists, skip"],
    ["elementVisibleClick", "If element visible, click"],
    ["fieldEmptyFill", "If field empty, fill"],
    ["addressAlreadyExistsSkipAccount", "If address exists, skip account"]
  ], (value) => deps.updateConditionForAction(action, value as NonNullable<RecordedAction["condition"]>["type"], action.condition?.text ?? ""));
}
