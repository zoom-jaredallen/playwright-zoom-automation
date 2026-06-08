import {
  buildBulkPolicyUpdate,
  buildStepMiniMap,
  bulkPolicyTargets,
  describeStep,
  stepPolicyBadges,
  type BulkPolicyTarget
} from "../shared/stepPresentation.js";
import type { RecordedAction } from "../shared/types.js";
import { selectorConfidence, type SelectorConfidence, isSubmitLikeClick } from "./qualityUtils.js";
import { makeActionButton, makeInsertTool } from "./uiControls.js";

export interface ActionListRenderInput {
  actionListEl: HTMLElement;
  emptyActionsEl: HTMLElement;
  stepMiniMapEl: HTMLElement;
  bulkTargetSelect: HTMLSelectElement;
  bulkTimeoutInput: HTMLInputElement;
  bulkRetryCountInput: HTMLInputElement;
  bulkRetryDelayInput: HTMLInputElement;
  bulkContinueOnFailureInput: HTMLInputElement;
  bulkScreenshotOnFailureInput: HTMLInputElement;
  actions: RecordedAction[];
  selectedActionId: string | undefined;
  testCurrentActionId: string | undefined;
  expandedActionIds: Set<string>;
  insertAfterActionId: string | null | undefined;
  stepFilterText: string;
  stepDensity: "comfortable" | "compact";
  testRunning: boolean;
  recording: boolean;
  setSelectedActionId(actionId: string | undefined): void;
  setExpandedActionIds(actionIds: Set<string>): void;
  setInsertAfterActionId(actionId: string | null | undefined): void;
  renderActions(): void;
  renderInlineStepEditor(action: RecordedAction, confidence: SelectorConfidence): HTMLElement;
  updateActionDescription(actionId: string, description: string): Promise<void>;
  testSingleStep(action: RecordedAction): Promise<void>;
  moveAction(actionId: string, direction: "up" | "down"): Promise<void>;
  deleteAction(actionId: string): Promise<void>;
  updateActionPatch(actionId: string, update: Partial<RecordedAction>): Promise<void>;
  addNavigationStep(): Promise<void>;
  addClickStep(): Promise<void>;
  addFillStep(): Promise<void>;
  addSelectStep(): Promise<void>;
  addAssertionStep(): Promise<void>;
  addPressStep(): Promise<void>;
  addScreenshotStep(): Promise<void>;
  addWaitStep(): Promise<void>;
  addDismissStep(): Promise<void>;
}

export function renderActionsPanel(input: ActionListRenderInput): void {
  input.actionListEl.innerHTML = "";
  input.emptyActionsEl.style.display = input.actions.length === 0 ? "grid" : "none";
  input.actionListEl.classList.toggle("compact", input.stepDensity === "compact");
  renderBulkTargetOptions(input);
  renderStepMiniMap(input);

  if (input.actions.length === 0) {
    input.actionListEl.appendChild(renderInsertRow(input, null));
    return;
  }

  const filteredActions = filteredStepEntries(input);
  if (filteredActions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact";
    empty.textContent = "No steps match the current filter.";
    input.actionListEl.appendChild(empty);
    return;
  }

  filteredActions.forEach(({ action, index }) => {
    const expanded = input.expandedActionIds.has(action.id);
    const item = document.createElement("article");
    item.className = `action-item${action.id === input.selectedActionId ? " selected" : ""}${action.id === input.testCurrentActionId ? " testing" : ""}${expanded ? " expanded" : ""}`;
    item.dataset.actionId = action.id;

    const header = document.createElement("div");
    header.className = "action-header";
    header.addEventListener("click", () => {
      input.setSelectedActionId(action.id);
      input.renderActions();
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
      toggleActionExpanded(input, action.id);
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
    description.addEventListener("blur", () => void input.updateActionDescription(action.id, description.value));
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
      makeActionButton("Test", input.testRunning || input.recording, () => void input.testSingleStep(action)),
      makeActionButton("Up", index === 0, () => void input.moveAction(action.id, "up")),
      makeActionButton("Down", index === input.actions.length - 1, () => void input.moveAction(action.id, "down")),
      makeActionButton("Delete", false, () => void input.deleteAction(action.id), "delete")
    );
    controls.addEventListener("click", (event) => event.stopPropagation());

    header.append(main, controls);
    item.appendChild(header);
    if (expanded) {
      item.appendChild(input.renderInlineStepEditor(action, confidence));
    }
    input.actionListEl.appendChild(item);
    if (!input.stepFilterText) {
      input.actionListEl.appendChild(renderInsertRow(input, action.id, index === input.actions.length - 1));
    }
  });
}

export function jumpToNextWeakStep(input: ActionListRenderInput): void {
  const currentIndex = input.selectedActionId ? input.actions.findIndex((action) => action.id === input.selectedActionId) : -1;
  const ordered = input.actions.slice(currentIndex + 1).concat(input.actions.slice(0, Math.max(currentIndex + 1, 0)));
  const target = ordered.find((action) => selectorConfidence(action).level === "weak" || isSubmitLikeClick(action));
  if (target) {
    input.setSelectedActionId(target.id);
    input.setExpandedActionIds(new Set([target.id]));
    input.renderActions();
    window.requestAnimationFrame(() => jumpToStep(target.id));
  }
}

export async function applyBulkPolicy(input: ActionListRenderInput): Promise<void> {
  const targets = currentBulkTargets(input);
  const target = targets[input.bulkTargetSelect.value as keyof typeof targets] ?? targets.allSteps;
  const update = buildBulkPolicyUpdate({
    timeout: input.bulkTimeoutInput.value,
    retryCount: input.bulkRetryCountInput.value,
    retryDelayMs: input.bulkRetryDelayInput.value,
    enableContinueOnFailure: input.bulkContinueOnFailureInput.checked,
    enableScreenshotOnFailure: input.bulkScreenshotOnFailureInput.checked
  });
  for (const actionId of target.actionIds) {
    await input.updateActionPatch(actionId, update);
  }
}

function renderStepMiniMap(input: ActionListRenderInput): void {
  input.stepMiniMapEl.innerHTML = "";
  const items = buildStepMiniMap(input.actions);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mini-map-step ${item.level}${item.actionId === input.selectedActionId ? " active" : ""}`;
    button.textContent = String(item.index);
    button.title = item.title;
    button.addEventListener("click", () => {
      input.setSelectedActionId(item.actionId);
      input.setExpandedActionIds(new Set([item.actionId]));
      input.renderActions();
      window.requestAnimationFrame(() => jumpToStep(item.actionId));
    });
    input.stepMiniMapEl.appendChild(button);
  }
}

function jumpToStep(actionId: string): void {
  const target = document.querySelector(`[data-action-id="${cssEscape(actionId)}"]`);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function filteredStepEntries(input: ActionListRenderInput): Array<{ action: RecordedAction; index: number }> {
  const entries = input.actions.map((action, index) => ({ action, index }));
  if (!input.stepFilterText) return entries;
  return entries.filter(({ action, index }) => {
    const haystack = [
      String(index + 1),
      action.type,
      action.description,
      action.value,
      action.expected,
      action.url,
      action.selectors.role?.name,
      action.selectors.label,
      action.selectors.text,
      action.selectors.css
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(input.stepFilterText);
  });
}

function toggleActionExpanded(input: ActionListRenderInput, actionId: string): void {
  const next = new Set(input.expandedActionIds);
  if (next.has(actionId)) {
    next.delete(actionId);
  } else {
    next.add(actionId);
    input.setSelectedActionId(actionId);
  }
  input.setExpandedActionIds(next);
  input.renderActions();
}

function renderStepBadges(action: RecordedAction): HTMLElement | undefined {
  const badges = stepPolicyBadges(action);
  if (badges.length === 0) return undefined;
  const wrapper = document.createElement("span");
  wrapper.className = "step-badges";
  for (const badge of badges) {
    const item = document.createElement("span");
    item.className = `step-badge ${badge.kind}`;
    item.textContent = badge.label;
    item.title = badge.title;
    wrapper.appendChild(item);
  }
  return wrapper;
}

function renderBulkTargetOptions(input: ActionListRenderInput): void {
  const current = input.bulkTargetSelect.value;
  input.bulkTargetSelect.innerHTML = "";
  const targets = bulkPolicyTargets(input.actions);
  for (const [key, target] of Object.entries(targets)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${target.label} (${target.actionIds.length})`;
    input.bulkTargetSelect.appendChild(option);
  }
  input.bulkTargetSelect.value = targets[current as keyof typeof targets] ? current : "allSteps";
}

function currentBulkTargets(input: ActionListRenderInput): Record<keyof ReturnType<typeof bulkPolicyTargets>, BulkPolicyTarget> {
  return bulkPolicyTargets(input.actions);
}

function renderInsertRow(input: ActionListRenderInput, afterActionId: string | null, isLast = false): HTMLElement {
  const row = document.createElement("div");
  row.className = `insert-row${input.insertAfterActionId === afterActionId ? " open" : ""}${isLast ? " last" : ""}`;

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "insert-plus";
  plus.title = afterActionId === null ? "Insert first step" : "Insert step here";
  plus.textContent = "+";
  plus.addEventListener("click", () => {
    input.setInsertAfterActionId(input.insertAfterActionId === afterActionId ? undefined : afterActionId);
    input.renderActions();
  });
  row.appendChild(plus);

  if (input.insertAfterActionId === afterActionId) {
    const tools = document.createElement("div");
    tools.className = "insert-tools";
    tools.append(
      makeInsertTool("navigate", "Navigate", () => void input.addNavigationStep()),
      makeInsertTool("click", "Click", () => void input.addClickStep()),
      makeInsertTool("fill", "Type text", () => void input.addFillStep()),
      makeInsertTool("select", "Select option", () => void input.addSelectStep()),
      makeInsertTool("validate", "Validate", () => void input.addAssertionStep()),
      makeInsertTool("press", "Press key", () => void input.addPressStep()),
      makeInsertTool("screenshot", "Shot", () => void input.addScreenshotStep()),
      makeInsertTool("wait", "Wait", () => void input.addWaitStep()),
      makeInsertTool("dismiss", "Dismiss popup", () => void input.addDismissStep())
    );
    row.appendChild(tools);
  }

  return row;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
