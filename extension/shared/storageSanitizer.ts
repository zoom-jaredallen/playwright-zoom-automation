import type { RecordedAction, RecordedWorkflow } from "@zoom-automation/workflow-core";

export function stripStorageHeavyActionFields(action: RecordedAction): RecordedAction {
  if (!action.capture?.thumbnail?.dataUrl) {
    return cloneJson(action);
  }

  const next = cloneJson(action);
  if (next.capture) {
    next.capture = {
      ...next.capture,
      thumbnail: undefined
    };
  }
  return next;
}

export function stripStorageHeavyWorkflowFields(workflow: RecordedWorkflow): RecordedWorkflow {
  return {
    ...cloneJson(workflow),
    actions: workflow.actions.map(stripStorageHeavyActionFields)
  };
}

export function stripStorageHeavyActions(actions: RecordedAction[]): RecordedAction[] {
  return actions.map(stripStorageHeavyActionFields);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
