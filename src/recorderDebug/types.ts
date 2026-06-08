import type { RecordedAction, RecordedWorkflow, WorkflowQualityReport } from "@zoom-automation/workflow-core";

export type RecorderDebugCommandType =
  | "BUILD_WORKFLOW"
  | "GET_ACTIONS"
  | "GET_TEST_WORKFLOW_STATE"
  | "START_RECORDING"
  | "STOP_RECORDING"
  | "RELOAD_EXTENSION"
  | "IMPORT_WORKFLOW"
  | "IMPORT_AND_RUN_TEST_WORKFLOW"
  | "IMPORT_AND_RUN_TEST_WORKFLOW_FROM"
  | "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW"
  | "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW_FROM"
  | "RUN_TEST_WORKFLOW"
  | "RUN_TEST_WORKFLOW_FROM"
  | "RUN_TRUSTED_TEST_WORKFLOW"
  | "RUN_TRUSTED_TEST_WORKFLOW_FROM"
  | "RUN_TEST_ACTION"
  | "TEST_SELECTOR"
  | "RUN_TRAINING_WORKFLOW"
  | "CLEAR_ACTIONS";

export interface RecorderDebugStatus {
  recording: boolean;
  paused: boolean;
  actionCount: number;
}

export interface RecorderDebugTestEvent {
  timestamp: number;
  level: "info" | "success" | "error";
  message: string;
  actionId?: string;
}

export interface RecorderDebugTestState {
  running: boolean;
  currentActionId?: string;
  events: RecorderDebugTestEvent[];
}

export interface RecorderDebugPage {
  url: string;
  title: string;
}

export interface RecorderDebugSnapshot {
  sessionId: string;
  timestamp: string;
  source: "extension" | "cli" | "server";
  status: RecorderDebugStatus;
  rawActions: RecordedAction[];
  preparedActions: RecordedAction[];
  workflow?: RecordedWorkflow;
  quality?: WorkflowQualityReport;
  testState: RecorderDebugTestState;
  page?: RecorderDebugPage;
}

export interface RecorderDebugSessionSummary {
  sessionId: string;
  timestamp: string;
  actionCount: number;
  preparedActionCount: number;
  workflowName?: string;
  qualityScore?: number;
  url?: string;
  title?: string;
}

export interface RecorderDebugCommandInput {
  type: RecorderDebugCommandType;
  payload?: Record<string, unknown>;
}

export interface RecorderTrainingRunOptions {
  iterations: number;
  fromActionId?: string;
  delayMs?: number;
  stopOnFailure?: boolean;
}

export interface RecorderTrainingIteration {
  index: number;
  ok: boolean;
  durationMs: number;
  failedActionId?: string;
  error?: string;
  events: RecorderDebugTestEvent[];
}

export interface RecorderTrainingStepHealth {
  actionId: string;
  description?: string;
  attempts: number;
  passes: number;
  failures: number;
  failureRate: number;
  lastError?: string;
}

export interface RecorderTrainingReport {
  sessionId: string;
  workflowName?: string;
  startedAt: string;
  finishedAt: string;
  summary: {
    iterations: number;
    passed: number;
    failed: number;
    completionRate: number;
    score: number;
  };
  iterations: RecorderTrainingIteration[];
  stepHealth: RecorderTrainingStepHealth[];
  recommendations: string[];
}

export interface RecorderWorkflowAudit {
  score: number;
  riskySteps: Array<{
    actionId: string;
    description?: string;
    reasons: string[];
  }>;
  recommendations: string[];
}

export interface RecorderActionDiff {
  rawCount: number;
  preparedCount: number;
  removed: Array<{
    id: string;
    type: string;
    description?: string;
  }>;
}

export type RecorderDebugCommandStatus = "pending" | "leased" | "completed" | "failed";

export interface RecorderDebugCommand extends RecorderDebugCommandInput {
  id: string;
  status: RecorderDebugCommandStatus;
  createdAt: string;
  leasedAt?: string;
  completedAt?: string;
  result?: RecorderDebugCommandResult;
}

export interface RecorderDebugCommandResult {
  ok: boolean;
  message?: string;
  error?: string;
  workflow?: RecordedWorkflow;
  actions?: RecordedAction[];
  testState?: RecorderDebugTestState;
  events?: RecorderDebugTestEvent[];
  trainingReport?: RecorderTrainingReport;
  diagnostic?: unknown;
}

export interface RecorderDebugEvent {
  timestamp: string;
  event: string;
  sessionId?: string;
  commandId?: string;
  level?: "info" | "success" | "error";
  message?: string;
  metadata?: Record<string, unknown>;
}
