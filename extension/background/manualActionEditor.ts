import type { RecordedAction } from "../shared/types.js";
import {
  applyStepUpdate,
  insertStep,
  makeAssertionAction,
  makeClickAction,
  makeDialogAction,
  makeDismissAction,
  makeFillAction,
  makeNavigationAction,
  makePressAction,
  makeScreenshotAction,
  makeSelectAction,
  makeWaitAction,
  moveStep,
  type StepUpdate
} from "@zoom-automation/workflow-core";

export interface ActionEditState {
  actions: RecordedAction[];
  recordingStartUrl: string;
}

export function updateRecordedAction(state: ActionEditState, actionId: string, update: StepUpdate): ActionEditState {
  const existing = state.actions.find((candidate) => candidate.id === actionId);
  if (!existing) return state;
  const previousPageUrl = existing.pageUrl;
  const actions = state.actions.map((action) => (action.id === actionId ? applyStepUpdate(action, update) : action));
  let recordingStartUrl = state.recordingStartUrl;

  if (update.url !== undefined && existing.type === "navigate") {
    const updated = actions.find((candidate) => candidate.id === actionId);
    if (updated?.url && (!recordingStartUrl || recordingStartUrl === previousPageUrl)) {
      recordingStartUrl = updated.url;
    }
  }

  return { actions, recordingStartUrl };
}

export function insertDialogAction(
  state: ActionEditState,
  dialogAction: NonNullable<RecordedAction["dialogAction"]>,
  promptText?: string,
  insertAfterActionId?: string | null
): ActionEditState {
  return {
    ...state,
    actions: insertStep(state.actions, makeDialogAction(dialogAction, promptText, state.recordingStartUrl), insertAfterActionId)
  };
}

export function moveRecordedAction(state: ActionEditState, actionId: string, direction: "up" | "down"): ActionEditState {
  return { ...state, actions: moveStep(state.actions, actionId, direction) };
}

export function insertNavigationAction(state: ActionEditState, rawUrl: string, insertAfterActionId?: string | null): ActionEditState {
  const action = makeNavigationAction(rawUrl);
  return {
    actions: insertStep(state.actions, action, insertAfterActionId),
    recordingStartUrl: state.recordingStartUrl || action.url || ""
  };
}

export function insertAssertionAction(
  state: ActionEditState,
  assertionType: RecordedAction["assertionType"],
  expected: string,
  timeout = 10_000,
  onFailure: RecordedAction["onFailure"] = "screenshot",
  insertAfterActionId?: string | null
): ActionEditState {
  return {
    ...state,
    actions: insertStep(
      state.actions,
      makeAssertionAction(assertionType, expected, state.recordingStartUrl, timeout, onFailure),
      insertAfterActionId
    )
  };
}

export function insertClickAction(state: ActionEditState, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeClickAction(state.recordingStartUrl), insertAfterActionId) };
}

export function insertFillAction(state: ActionEditState, value?: string, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeFillAction(value, state.recordingStartUrl), insertAfterActionId) };
}

export function insertSelectAction(state: ActionEditState, value?: string, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeSelectAction(value, state.recordingStartUrl), insertAfterActionId) };
}

export function insertPressAction(state: ActionEditState, key?: string, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makePressAction(key, state.recordingStartUrl), insertAfterActionId) };
}

export function insertScreenshotAction(state: ActionEditState, label?: string, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeScreenshotAction(label, state.recordingStartUrl), insertAfterActionId) };
}

export function insertWaitAction(state: ActionEditState, waitMs: number, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeWaitAction(waitMs, state.recordingStartUrl), insertAfterActionId) };
}

export function insertDismissAction(state: ActionEditState, insertAfterActionId?: string | null): ActionEditState {
  return { ...state, actions: insertStep(state.actions, makeDismissAction(state.recordingStartUrl), insertAfterActionId) };
}

export function lastInsertedActionId(actions: RecordedAction[], insertAfterActionId?: string | null): string | undefined {
  if (insertAfterActionId === null) return actions[0]?.id;
  if (insertAfterActionId) {
    const index = actions.findIndex((candidate) => candidate.id === insertAfterActionId);
    return index >= 0 ? actions[index + 1]?.id : actions.at(-1)?.id;
  }
  return actions.at(-1)?.id;
}
