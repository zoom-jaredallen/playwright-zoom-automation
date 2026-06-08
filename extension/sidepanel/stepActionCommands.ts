import { applySelectorCandidate } from "../shared/selectorRepair.js";
import { suggestParameterReplacements } from "../shared/authoringAssistants.js";
import type { AnchorPickResult, ExtensionMessage, RecordedAction, SelectorPickResult, SelectorTestResult } from "../shared/types.js";
import { formatSelectors, hasUsableSelector, isSubmitLikeClick } from "./qualityUtils.js";

export interface StepActionDeps {
  actions: RecordedAction[];
  selectedActionId: string | undefined;
  sendMessage(message: ExtensionMessage): Promise<any>;
  refreshState(): Promise<void>;
  render(): void;
  setMessage(message: string): void;
  selectAndExpandAction(actionId: string | undefined): void;
  setSelectedActionId(actionId: string | undefined): void;
  setExpandedActionIds(actionIds: Set<string>): void;
  setInsertAfterActionId(actionId: string | null | undefined): void;
  setSelectorTestResults(results: Record<string, SelectorTestResult>): void;
  getSelectorTestResults(): Record<string, SelectorTestResult>;
  setStepTestResults(results: Record<string, { level: "success" | "error" | "info"; message: string }>): void;
  getStepTestResults(): Record<string, { level: "success" | "error" | "info"; message: string }>;
}

export async function updateActionDescription(deps: StepActionDeps, actionId: string, description: string): Promise<void> {
  await deps.sendMessage({ type: "UPDATE_ACTION", actionId, description });
  await deps.refreshState();
}

export async function updateActionPatch(deps: StepActionDeps, actionId: string, update: Omit<Extract<ExtensionMessage, { type: "UPDATE_ACTION" }>, "type" | "actionId">): Promise<void> {
  await deps.sendMessage({ type: "UPDATE_ACTION", actionId, ...update });
  await deps.refreshState();
}

export async function updateActionSelector(deps: StepActionDeps, actionId: string, cssSelector: string | undefined, selectorNote: string | undefined): Promise<void> {
  await deps.sendMessage({ type: "UPDATE_ACTION", actionId, cssSelector, selectorNote });
  await deps.refreshState();
}

export async function updateConditionForAction(deps: StepActionDeps, action: RecordedAction, type: NonNullable<RecordedAction["condition"]>["type"], text: string): Promise<void> {
  await updateActionPatch(deps, action.id, {
    condition: {
      type,
      text: text.trim() || undefined,
      selector: action.selectors
    }
  });
}

export async function testSelectorForAction(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  deps.setSelectedActionId(action.id);
  deps.setExpandedActionIds(new Set([action.id]));
  deps.setMessage("Testing selector in the active page...");
  const result = await deps.sendMessage({ type: "TEST_SELECTOR", action }) as SelectorTestResult;
  deps.setSelectorTestResults({ ...deps.getSelectorTestResults(), [action.id]: result });
  if (!result.error) {
    await deps.sendMessage({
      type: "UPDATE_ACTION",
      actionId: action.id,
      selectorDiagnostics: result.selectorDiagnostics,
      repairSuggestions: result.repairSuggestions
    });
  }
  deps.render();
}

export async function highlightActionTarget(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  const response = await deps.sendMessage({ type: "HIGHLIGHT_ACTION_TARGET", action });
  if (!response?.ok) {
    deps.setMessage(response?.error ?? "Could not highlight this step on the current page.");
    return;
  }
  deps.setMessage("Target highlighted in the active tab.");
}

export async function testSingleStep(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  deps.setSelectedActionId(action.id);
  deps.setStepTestResults({
    ...deps.getStepTestResults(),
    [action.id]: { level: "info", message: "Testing this step against the active tab..." }
  });
  deps.render();

  const response = await deps.sendMessage({ type: "RUN_TEST_ACTION", action });
  deps.setStepTestResults({
    ...deps.getStepTestResults(),
    [action.id]: {
      level: response?.ok ? "success" : "error",
      message: response?.ok
        ? `Passed: ${action.description ?? action.type}`
        : `Failed: ${response?.error ?? "Step test failed."}`
    }
  });
  deps.setMessage(response?.ok ? "Step test passed." : (response?.error ?? "Step test failed."));
  await deps.refreshState();
}

export async function pickSelectorForAction(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "selectRows", "press", "assert"].includes(action.type)) {
    deps.setMessage("This step does not need a page target.");
    return;
  }

  deps.setSelectedActionId(action.id);
  deps.setExpandedActionIds(new Set([action.id]));
  deps.setMessage("Click the target element in the active Zoom tab. Press Esc to cancel.");
  const result = await deps.sendMessage({ type: "PICK_SELECTOR", action }) as SelectorPickResult;
  if (result.error) {
    deps.setSelectorTestResults({
      ...deps.getSelectorTestResults(),
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error }
    });
    deps.setMessage(result.error);
    deps.render();
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
  await deps.sendMessage({ type: "UPDATE_ACTION", actionId: action.id, ...update });
  deps.setSelectorTestResults({
    ...deps.getSelectorTestResults(),
    [action.id]: {
      actionId: action.id,
      matchedCount: 1,
      visibleCount: 1,
      chosenPreview: result.preview,
      chosenSelector: formatSelectors({ ...action, selectors: result.selectors }),
      fallbackCandidates: []
    }
  });
  deps.setMessage("Target selected for this step.");
  await deps.refreshState();
}

export async function pickAnchorForAction(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  if (!["click", "fill", "select", "selectRows", "press"].includes(action.type)) {
    deps.setMessage("This step does not need an anchor.");
    return;
  }
  if (!hasUsableSelector(action)) {
    deps.setMessage("Pick a target before adding an anchor.");
    return;
  }

  deps.setSelectedActionId(action.id);
  deps.setExpandedActionIds(new Set([action.id]));
  deps.setMessage("Click stable label, row, dialog, or section text in the active Zoom tab. Press Esc to cancel.");
  const result = await deps.sendMessage({ type: "PICK_ANCHOR", action }) as AnchorPickResult;
  if (result.error || !result.anchor) {
    deps.setSelectorTestResults({
      ...deps.getSelectorTestResults(),
      [action.id]: { actionId: action.id, matchedCount: 0, visibleCount: 0, fallbackCandidates: [], error: result.error ?? "No anchor was selected." }
    });
    deps.setMessage(result.error ?? "No anchor was selected.");
    deps.render();
    return;
  }

  const selectors = { ...action.selectors, anchor: result.anchor };
  await deps.sendMessage({ type: "UPDATE_ACTION", actionId: action.id, selectors });
  deps.setSelectorTestResults({
    ...deps.getSelectorTestResults(),
    [action.id]: {
      actionId: action.id,
      matchedCount: 1,
      visibleCount: 1,
      chosenPreview: result.preview,
      chosenSelector: formatSelectors({ ...action, selectors }),
      fallbackCandidates: []
    }
  });
  deps.setMessage("Anchor selected for this step.");
  await deps.refreshState();
}

export async function useSelectorCandidate(deps: StepActionDeps, actionId: string, selector: RecordedAction["selectors"]): Promise<void> {
  const action = deps.actions.find((candidate) => candidate.id === actionId);
  const selectors = action ? applySelectorCandidate(action.selectors, selector) : selector;
  await updateActionPatch(deps, actionId, { selectors });
  deps.setMessage("Selector candidate applied.");
}

export async function addSuggestedValidationStep(deps: StepActionDeps, actionOverride?: RecordedAction): Promise<void> {
  const action = actionOverride ?? deps.actions.find((candidate) => candidate.id === deps.selectedActionId);
  if (!action || !isSubmitLikeClick(action)) return;

  const response = await deps.sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: "textVisible",
    expected: "success|saved|added|submitted",
    timeout: 10_000,
    onFailure: "screenshot",
    insertAfterActionId: action.id
  });
  deps.selectAndExpandAction(response?.actionId);
  deps.setInsertAfterActionId(undefined);
  deps.setMessage("Validation step added after the submit action.");
  await deps.refreshState();
}

export async function moveAction(deps: StepActionDeps, actionId: string, direction: "up" | "down"): Promise<void> {
  await deps.sendMessage({ type: "MOVE_ACTION", actionId, direction });
  await deps.refreshState();
}

export async function deleteAction(deps: StepActionDeps, actionId: string): Promise<void> {
  await deps.sendMessage({ type: "DELETE_ACTION", actionId });
  deps.setMessage("Step deleted.");
  await deps.refreshState();
}

export async function updateParameter(deps: StepActionDeps, actionId: string, paramIndex: number, confirmed: boolean): Promise<void> {
  await deps.sendMessage({ type: "UPDATE_PARAMETER", actionId, paramIndex, confirmed });
  await deps.refreshState();
}

export async function applyParameterSuggestion(deps: StepActionDeps, suggestion: ReturnType<typeof suggestParameterReplacements>[number]): Promise<void> {
  const update = suggestion.field === "value"
    ? { value: suggestion.replacement }
    : { expected: suggestion.replacement };
  await updateActionPatch(deps, suggestion.actionId, update);
  deps.setMessage(`Applied parameter ${suggestion.replacement}.`);
}

export async function increaseStepTimeout(deps: StepActionDeps, action: RecordedAction): Promise<void> {
  const nextTimeout = Math.min((action.timeout ?? 10_000) + 5_000, 60_000);
  await updateActionPatch(deps, action.id, { timeout: nextTimeout });
  deps.setMessage(`Timeout increased to ${nextTimeout}ms.`);
}
