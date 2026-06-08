import type { RecordedAction, RecordedWorkflow } from "../shared/types.js";

export function validateImportWorkflow(workflow: RecordedWorkflow): string | undefined {
  if (!workflow || typeof workflow !== "object") return "Imported file is not a workflow JSON object.";
  if (workflow.version !== 1) return "Only recorded workflow version 1 is supported.";
  if (!Array.isArray(workflow.actions)) return "Imported workflow is missing an actions array.";
  if (workflow.actions.length === 0) return "Imported workflow does not contain any steps.";
  const invalidIndex = workflow.actions.findIndex((action) => !action?.type || !action.id);
  if (invalidIndex >= 0) return `Imported workflow has an invalid step at position ${invalidIndex + 1}.`;
  return undefined;
}

export function normalizeImportedAction(action: RecordedAction, recordingStartUrl: string): RecordedAction {
  return {
    ...action,
    timestamp: Number.isFinite(action.timestamp) ? action.timestamp : Date.now(),
    selectors: action.selectors ?? {},
    pageUrl: action.pageUrl ?? action.url ?? recordingStartUrl,
    pageTitle: action.pageTitle ?? "Imported workflow step"
  };
}

export function parseRecordedAt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function isRecordedWorkflow(value: unknown): value is RecordedWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecordedWorkflow>;
  return candidate.version === 1
    && Boolean(candidate.meta && typeof candidate.meta === "object")
    && Array.isArray(candidate.actions);
}

export function isRecordedAction(value: unknown): value is RecordedAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecordedAction>;
  return typeof candidate.id === "string"
    && typeof candidate.type === "string"
    && Boolean(candidate.selectors && typeof candidate.selectors === "object");
}
