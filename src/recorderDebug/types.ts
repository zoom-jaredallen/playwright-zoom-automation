import type { RecordedAction, RecordedWorkflow, WorkflowQualityReport } from "@zoom-automation/workflow-core";

export type RecorderDebugCommandType =
  | "BUILD_WORKFLOW"
  | "GET_ACTIONS"
  | "GET_TEST_WORKFLOW_STATE"
  | "RUN_TEST_WORKFLOW"
  | "RUN_TEST_WORKFLOW_FROM"
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
