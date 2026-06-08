import type express from "express";
import { createRecorderDebugStore } from "../services/recorderDebugStore.js";
import type {
  RecorderDebugCommandInput,
  RecorderDebugCommandResult,
  RecorderDebugCommandType,
  RecorderDebugSnapshot
} from "../../recorderDebug/types.js";

export function registerRecorderDebugRoutes(app: express.Express, recorderDebugStore: ReturnType<typeof createRecorderDebugStore>): void {
  app.post("/api/recorder/debug/snapshot", (request, response) => {
    const snapshot = request.body as Partial<RecorderDebugSnapshot>;
    const validation = validateRecorderDebugSnapshot(snapshot);
    if (validation) {
      response.status(400).json({ error: validation });
      return;
    }
    response.status(201).json({ snapshot: recorderDebugStore.saveSnapshot(snapshot as RecorderDebugSnapshot) });
  });

  app.get("/api/recorder/debug/latest", (_request, response) => {
    const snapshot = recorderDebugStore.latest();
    if (!snapshot) {
      response.status(404).json({ error: "No recorder debug snapshot available" });
      return;
    }
    response.json({ snapshot });
  });

  app.get("/api/recorder/debug/sessions", (_request, response) => {
    response.json({ sessions: recorderDebugStore.listSessions() });
  });

  app.get("/api/recorder/debug/sessions/:sessionId", (request, response) => {
    const snapshot = recorderDebugStore.getSession(request.params.sessionId);
    if (!snapshot) {
      response.status(404).json({ error: "Recorder debug session not found" });
      return;
    }
    response.json({ snapshot });
  });

  app.get("/api/recorder/debug/events", (request, response) => {
    const sessionId = typeof request.query.sessionId === "string" ? request.query.sessionId : undefined;
    response.json({ events: recorderDebugStore.listEvents(sessionId) });
  });

  app.get("/api/recorder/debug/training/latest", (_request, response) => {
    const report = recorderDebugStore.latestTrainingReport();
    if (!report) {
      response.status(404).json({ error: "No recorder training report available" });
      return;
    }
    response.json({ report });
  });

  app.post("/api/recorder/debug/commands", (request, response) => {
    const input = request.body as Partial<RecorderDebugCommandInput>;
    if (!isRecorderDebugCommandType(input.type)) {
      response.status(400).json({ error: "Unsupported recorder debug command type" });
      return;
    }
    response.status(201).json({
      command: recorderDebugStore.createCommand({ type: input.type, payload: input.payload ?? {} })
    });
  });

  app.get("/api/recorder/debug/commands/next", (_request, response) => {
    const command = recorderDebugStore.nextPendingCommand();
    response.json({ command: command ?? null });
  });

  app.get("/api/recorder/debug/commands/:commandId", (request, response) => {
    const command = recorderDebugStore.getCommand(request.params.commandId);
    if (!command) {
      response.status(404).json({ error: "Recorder debug command not found" });
      return;
    }
    response.json({ command });
  });

  app.post("/api/recorder/debug/commands/:commandId/result", (request, response) => {
    const result = request.body as Partial<RecorderDebugCommandResult>;
    if (typeof result.ok !== "boolean") {
      response.status(400).json({ error: "Command result requires boolean ok" });
      return;
    }
    try {
      response.json({
        command: recorderDebugStore.markCommandResult(request.params.commandId, result as RecorderDebugCommandResult)
      });
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const RECORDER_DEBUG_COMMAND_TYPES: readonly RecorderDebugCommandType[] = [
  "BUILD_WORKFLOW",
  "GET_ACTIONS",
  "GET_TEST_WORKFLOW_STATE",
  "START_RECORDING",
  "STOP_RECORDING",
  "RELOAD_EXTENSION",
  "IMPORT_WORKFLOW",
  "IMPORT_AND_RUN_TEST_WORKFLOW",
  "IMPORT_AND_RUN_TEST_WORKFLOW_FROM",
  "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW",
  "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW_FROM",
  "RUN_TEST_WORKFLOW",
  "RUN_TEST_WORKFLOW_FROM",
  "RUN_TRUSTED_TEST_WORKFLOW",
  "RUN_TRUSTED_TEST_WORKFLOW_FROM",
  "RUN_TEST_ACTION",
  "TEST_SELECTOR",
  "RUN_TRAINING_WORKFLOW",
  "CLEAR_ACTIONS"
];

function isRecorderDebugCommandType(value: unknown): value is RecorderDebugCommandType {
  return typeof value === "string" && RECORDER_DEBUG_COMMAND_TYPES.includes(value as RecorderDebugCommandType);
}

function validateRecorderDebugSnapshot(snapshot: Partial<RecorderDebugSnapshot>): string | undefined {
  if (!snapshot || typeof snapshot !== "object") return "Snapshot body is required";
  if (!snapshot.sessionId || typeof snapshot.sessionId !== "string") return "Snapshot requires sessionId";
  if (!snapshot.timestamp || typeof snapshot.timestamp !== "string") return "Snapshot requires timestamp";
  if (!snapshot.status || typeof snapshot.status !== "object") return "Snapshot requires status";
  if (!Array.isArray(snapshot.rawActions)) return "Snapshot requires rawActions";
  if (!Array.isArray(snapshot.preparedActions)) return "Snapshot requires preparedActions";
  if (!snapshot.testState || typeof snapshot.testState !== "object" || !Array.isArray(snapshot.testState.events)) {
    return "Snapshot requires testState.events";
  }
  return undefined;
}
