/**
 * The recorded-workflow schema is shared via `@zoom-automation/workflow-core`.
 * This module re-exports it (so existing `../shared/types.js` imports keep
 * working) and defines the extension-only types that depend on chrome messaging.
 */
export type {
  ActionType,
  SelectorStrategy,
  ParameterHint,
  RecordedAction,
  StepCondition,
  WorkflowParameter,
  WorkflowAssertion,
  WorkflowCategory,
  WorkflowQualityReport,
  RecordedWorkflow,
  AssertionType,
  OnFailure
} from "@zoom-automation/workflow-core";

import type { RankedSelectorCandidate, RecordedAction, RecordedWorkflow, SelectorCandidate, SelectorStrategy } from "@zoom-automation/workflow-core";

// ─── Extension-only types ──────────────────────────────────────────────────────

export interface SelectorTestResult {
  actionId: string;
  matchedCount: number;
  visibleCount: number;
  chosenPreview?: string;
  chosenSelector?: string;
  fallbackCandidates: Array<{
    selector: SelectorStrategy;
    label: string;
    matchedCount: number;
    visibleCount: number;
    candidateId?: string;
    kind?: SelectorCandidate["kind"];
    score?: number;
    scoreLevel?: RankedSelectorCandidate["score"]["level"];
  }>;
  error?: string;
}

export interface SelectorPickResult {
  actionId: string;
  selectors: SelectorStrategy;
  selectorCandidates?: SelectorCandidate[];
  selectedCandidateId?: string;
  frameSelector?: string;
  preview?: string;
  description?: string;
  value?: string;
  error?: string;
}

export interface AnchorPickResult {
  actionId: string;
  anchor?: NonNullable<SelectorStrategy["anchor"]>;
  preview?: string;
  error?: string;
}

export interface WorkflowTestEvent {
  timestamp: number;
  level: "info" | "success" | "error";
  message: string;
  actionId?: string;
}

// ─── Extension Messages ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "PAUSE_RECORDING" }
  | { type: "RESUME_RECORDING" }
  | { type: "GET_STATUS" }
  | { type: "SET_EXTENSION_ENABLED"; enabled: boolean }
  | { type: "ACTION_RECORDED"; action: RecordedAction }
  | { type: "STATUS_RESPONSE"; recording: boolean; paused: boolean; actionCount: number }
  | { type: "RECORDER_STATE_UPDATED"; recording: boolean; paused: boolean; actions: RecordedAction[] }
  | { type: "TEST_WORKFLOW_STATE_UPDATED"; running: boolean; currentActionId?: string; events: WorkflowTestEvent[] }
  | { type: "RECORDING_STARTED" }
  | { type: "RECORDING_STOPPED"; workflow: RecordedWorkflow }
  | { type: "UPDATE_PARAMETER"; actionId: string; paramIndex: number; confirmed: boolean }
  | {
      type: "UPDATE_ACTION";
      actionId: string;
      description?: string;
      selectors?: RecordedAction["selectors"];
      selectorCandidates?: RecordedAction["selectorCandidates"];
      selectedCandidateId?: RecordedAction["selectedCandidateId"];
      cssSelector?: string;
      selectorNote?: string;
      frameSelector?: string;
      url?: string;
      assertionType?: RecordedAction["assertionType"];
      expected?: string;
      timeout?: number;
      onFailure?: RecordedAction["onFailure"];
      retryCount?: number;
      retryDelayMs?: number;
      continueOnFailure?: boolean;
      screenshotOnFailure?: boolean;
      condition?: RecordedAction["condition"];
      screenshotLabel?: string;
      waitMs?: number;
      value?: string;
      networkWaitUrl?: string;
      waitForUrl?: string;
      key?: string;
      dialogAction?: RecordedAction["dialogAction"];
      dialogPromptText?: string;
      elementScreenshot?: boolean;
      capture?: RecordedAction["capture"];
      selectorDiagnostics?: RecordedAction["selectorDiagnostics"];
      repairSuggestions?: RecordedAction["repairSuggestions"];
    }
  | { type: "MOVE_ACTION"; actionId: string; direction: "up" | "down" }
  | { type: "ADD_DIALOG_ACTION"; dialogAction: NonNullable<RecordedAction["dialogAction"]>; promptText?: string; insertAfterActionId?: string | null }
  | { type: "DELETE_ACTION"; actionId: string }
  | { type: "ADD_NAVIGATION_ACTION"; url: string; insertAfterActionId?: string | null }
  | { type: "ADD_ASSERTION_ACTION"; assertionType: RecordedAction["assertionType"]; expected: string; timeout?: number; onFailure?: RecordedAction["onFailure"]; insertAfterActionId?: string | null }
  | { type: "ADD_CLICK_ACTION"; insertAfterActionId?: string | null }
  | { type: "ADD_FILL_ACTION"; value?: string; insertAfterActionId?: string | null }
  | { type: "ADD_SELECT_ACTION"; value?: string; insertAfterActionId?: string | null }
  | { type: "ADD_PRESS_ACTION"; key?: string; insertAfterActionId?: string | null }
  | { type: "ADD_SCREENSHOT_ACTION"; label?: string; insertAfterActionId?: string | null }
  | { type: "ADD_WAIT_ACTION"; waitMs: number; insertAfterActionId?: string | null }
  | { type: "ADD_DISMISS_ACTION"; insertAfterActionId?: string | null }
  | { type: "CLEAR_ACTIONS" }
  | { type: "IMPORT_WORKFLOW"; workflow: RecordedWorkflow }
  | { type: "GET_ACTIONS" }
  | { type: "BUILD_WORKFLOW" }
  | { type: "RUN_TEST_WORKFLOW" }
  | { type: "RUN_TEST_WORKFLOW_FROM"; actionId: string }
  | { type: "RUN_TEST_ACTION"; action: RecordedAction }
  | { type: "GET_TEST_WORKFLOW_STATE" }
  | { type: "WAIT_FOR_PAGE_READY"; timeout?: number }
  | { type: "EXECUTE_TEST_ACTION"; action: RecordedAction }
  | { type: "TEST_SELECTOR"; action: RecordedAction }
  | { type: "HIGHLIGHT_ACTION_TARGET"; action: RecordedAction }
  | { type: "PICK_SELECTOR"; action: RecordedAction }
  | { type: "PICK_ANCHOR"; action: RecordedAction }
  | { type: "ACTIONS_RESPONSE"; actions: RecordedAction[] };
