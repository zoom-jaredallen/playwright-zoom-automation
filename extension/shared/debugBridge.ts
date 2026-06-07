import type { RecordedAction, RecordedWorkflow, WorkflowQualityReport } from "@zoom-automation/workflow-core";
import type { WorkflowTestEvent } from "./types.js";

export type RecorderDebugCommandType =
  | "BUILD_WORKFLOW"
  | "GET_ACTIONS"
  | "GET_TEST_WORKFLOW_STATE"
  | "RUN_TEST_WORKFLOW"
  | "RUN_TEST_WORKFLOW_FROM"
  | "RUN_TRAINING_WORKFLOW"
  | "CLEAR_ACTIONS";

export interface RecorderDebugCommand {
  id: string;
  type: RecorderDebugCommandType;
  status: "pending" | "leased" | "completed" | "failed";
  payload?: Record<string, unknown>;
}

export interface RecorderDebugSnapshot {
  sessionId: string;
  timestamp: string;
  source: "extension";
  status: {
    recording: boolean;
    paused: boolean;
    actionCount: number;
  };
  rawActions: RecordedAction[];
  preparedActions: RecordedAction[];
  workflow?: RecordedWorkflow;
  quality?: WorkflowQualityReport;
  testState: {
    running: boolean;
    currentActionId?: string;
    events: WorkflowTestEvent[];
  };
  page?: {
    url: string;
    title: string;
  };
}

export interface RecorderDebugCommandResult {
  ok: boolean;
  message?: string;
  error?: string;
  workflow?: RecordedWorkflow;
  actions?: RecordedAction[];
  testState?: RecorderDebugSnapshot["testState"];
  events?: WorkflowTestEvent[];
  trainingReport?: RecorderTrainingReport;
}

export interface RecorderTrainingIteration {
  index: number;
  ok: boolean;
  durationMs: number;
  failedActionId?: string;
  error?: string;
  events: WorkflowTestEvent[];
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
  stepHealth: Array<{
    actionId: string;
    description?: string;
    attempts: number;
    passes: number;
    failures: number;
    failureRate: number;
    lastError?: string;
  }>;
  recommendations: string[];
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:4174";

export async function postRecorderDebugSnapshot(snapshot: RecorderDebugSnapshot): Promise<void> {
  await postJson("/api/recorder/debug/snapshot", snapshot);
}

export async function fetchNextRecorderDebugCommand(): Promise<RecorderDebugCommand | undefined> {
  const response = await fetchJson<{ command: RecorderDebugCommand | null }>("/api/recorder/debug/commands/next");
  return response.command ?? undefined;
}

export async function postRecorderDebugCommandResult(commandId: string, result: RecorderDebugCommandResult): Promise<void> {
  await postJson(`/api/recorder/debug/commands/${encodeURIComponent(commandId)}/result`, result);
}

export async function recorderDebugBaseUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("serverUrl");
  const configured = typeof stored.serverUrl === "string" && stored.serverUrl.trim()
    ? stored.serverUrl.trim()
    : DEFAULT_SERVER_URL;
  return configured.replace(/\/+$/, "");
}

async function fetchJson<T>(path: string): Promise<T> {
  const baseUrl = await recorderDebugBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Recorder debug bridge failed: ${response.status}`);
  return await response.json() as T;
}

async function postJson(path: string, body: unknown): Promise<void> {
  const baseUrl = await recorderDebugBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Recorder debug bridge failed: ${response.status}`);
}
