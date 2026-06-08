import type { RecordedAction, RecordedWorkflow, WorkflowTestEvent } from "../shared/types.js";
import { firstRecordableNavigationUrl, shouldRecordNavigationUrl } from "../shared/navigationPolicy.js";
import { stripStorageHeavyActions, stripStorageHeavyWorkflowFields } from "../shared/storageSanitizer.js";
import { isRecordedWorkflow } from "./workflowImport.js";

export const DRAFT_STORAGE_KEY = "recorderDraftState";

export interface DraftState {
  recording: boolean;
  paused: boolean;
  actions: RecordedAction[];
  recordingStartTime: number;
  recordingStartUrl: string;
  impersonationDetected: boolean;
  activeTabId?: number;
}

export async function loadDraftState(): Promise<DraftState | undefined> {
  const stored = await getDraftStorage().get(DRAFT_STORAGE_KEY);
  const draft = stored[DRAFT_STORAGE_KEY] as DraftState | undefined;
  if (!draft) return undefined;
  return {
    ...draft,
    actions: draft.actions ?? [],
    recordingStartUrl: shouldRecordNavigationUrl(draft.recordingStartUrl)
      ? draft.recordingStartUrl
      : firstRecordableNavigationUrl(draft.actions ?? []) ?? ""
  };
}

export async function saveDraftState(
  draft: DraftState,
  onError: (level: WorkflowTestEvent["level"], message: string) => void
): Promise<void> {
  await safeStorageSet(getDraftStorage(), {
    [DRAFT_STORAGE_KEY]: {
      ...draft,
      actions: stripStorageHeavyActions(draft.actions)
    } satisfies DraftState
  }, [DRAFT_STORAGE_KEY], onError);
}

export async function clearDraftState(): Promise<void> {
  await getDraftStorage().remove(DRAFT_STORAGE_KEY);
}

export async function loadLastRecordedActions(): Promise<RecordedAction[]> {
  const stored = await chrome.storage.local.get("lastActions");
  return Array.isArray(stored.lastActions) ? stored.lastActions as RecordedAction[] : [];
}

export async function loadLastWorkflow(): Promise<RecordedWorkflow | undefined> {
  const stored = await chrome.storage.local.get("lastWorkflow");
  return isRecordedWorkflow(stored.lastWorkflow) ? stored.lastWorkflow : undefined;
}

export async function persistLastWorkflow(
  workflow: RecordedWorkflow,
  workflowActions: RecordedAction[],
  onError: (level: WorkflowTestEvent["level"], message: string) => void
): Promise<void> {
  const storageWorkflow = stripStorageHeavyWorkflowFields({ ...workflow, actions: workflowActions });
  await safeStorageSet(chrome.storage.local, {
    lastWorkflow: storageWorkflow,
    lastActions: stripStorageHeavyActions(workflowActions)
  }, ["lastWorkflow", "lastActions"], onError);
}

function getDraftStorage(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

async function safeStorageSet(
  area: chrome.storage.StorageArea,
  values: Record<string, unknown>,
  replacementKeys: string[],
  onError: (level: WorkflowTestEvent["level"], message: string) => void
): Promise<boolean> {
  try {
    await area.set(values);
    return true;
  } catch {
    await area.remove(replacementKeys).catch(() => undefined);
    try {
      await area.set(values);
      return true;
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      onError("error", `Recorder storage persistence skipped: ${message}`);
      return false;
    }
  }
}
