import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  RecorderDebugCommand,
  RecorderDebugCommandInput,
  RecorderDebugCommandResult,
  RecorderDebugEvent,
  RecorderDebugSessionSummary,
  RecorderDebugSnapshot,
  RecorderTrainingReport
} from "../../recorderDebug/types.js";

export interface RecorderDebugStore {
  saveSnapshot(snapshot: RecorderDebugSnapshot): RecorderDebugSnapshot;
  latest(): RecorderDebugSnapshot | undefined;
  listSessions(): RecorderDebugSessionSummary[];
  getSession(sessionId: string): RecorderDebugSnapshot | undefined;
  listEvents(sessionId?: string): RecorderDebugEvent[];
  latestTrainingReport(): RecorderTrainingReport | undefined;
  createCommand(input: RecorderDebugCommandInput): RecorderDebugCommand;
  nextPendingCommand(): RecorderDebugCommand | undefined;
  getCommand(commandId: string): RecorderDebugCommand | undefined;
  markCommandResult(commandId: string, result: RecorderDebugCommandResult): RecorderDebugCommand;
}

export interface RecorderDebugStoreOptions {
  directory: string;
}

export function createRecorderDebugStore(options: RecorderDebugStoreOptions): RecorderDebugStore {
  const root = path.resolve(options.directory);
  const commandsDir = path.join(root, "commands");
  ensureDir(root);
  ensureDir(commandsDir);

  function sessionDir(sessionId: string): string {
    const safeId = safePathSegment(sessionId);
    return path.join(root, safeId);
  }

  function commandPath(commandId: string): string {
    return path.join(commandsDir, `${safePathSegment(commandId)}.json`);
  }

  function appendEvent(event: Omit<RecorderDebugEvent, "timestamp"> & { timestamp?: string }): void {
    const entry: RecorderDebugEvent = {
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event
    };
    appendFileSync(path.join(root, "events.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    if (entry.sessionId) {
      const dir = sessionDir(entry.sessionId);
      ensureDir(dir);
      appendFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    }
  }

  return {
    saveSnapshot(snapshot) {
      const dir = sessionDir(snapshot.sessionId);
      ensureDir(dir);
      writeJson(path.join(dir, "snapshot.json"), snapshot);
      writeJson(path.join(dir, "raw-actions.json"), snapshot.rawActions);
      writeJson(path.join(dir, "prepared-actions.json"), snapshot.preparedActions);
      if (snapshot.workflow) writeJson(path.join(dir, "workflow.json"), snapshot.workflow);
      writeJson(path.join(root, "latest.json"), snapshot);
      appendEvent({
        event: "snapshot_saved",
        sessionId: snapshot.sessionId,
        message: `Recorder snapshot saved with ${snapshot.preparedActions.length} prepared step(s).`,
        metadata: { actionCount: snapshot.rawActions.length, preparedActionCount: snapshot.preparedActions.length }
      });
      return snapshot;
    },

    latest() {
      return readJson<RecorderDebugSnapshot>(path.join(root, "latest.json"));
    },

    listSessions() {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "commands")
        .map((entry) => readJson<RecorderDebugSnapshot>(path.join(root, entry.name, "snapshot.json")))
        .filter((snapshot): snapshot is RecorderDebugSnapshot => Boolean(snapshot))
        .map(toSummary)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },

    getSession(sessionId) {
      return readJson<RecorderDebugSnapshot>(path.join(sessionDir(sessionId), "snapshot.json"));
    },

    listEvents(sessionId) {
      const filePath = sessionId ? path.join(sessionDir(sessionId), "events.jsonl") : path.join(root, "events.jsonl");
      if (!existsSync(filePath)) return [];
      return readFileSync(filePath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RecorderDebugEvent);
    },

    latestTrainingReport() {
      return readJson<RecorderTrainingReport>(path.join(root, "latest-training-report.json"));
    },

    createCommand(input) {
      const command: RecorderDebugCommand = {
        id: randomUUID(),
        status: "pending",
        createdAt: new Date().toISOString(),
        type: input.type,
        payload: input.payload ?? {}
      };
      writeJson(commandPath(command.id), command);
      appendEvent({ event: "command_created", commandId: command.id, message: `Created ${command.type} debug command.` });
      return command;
    },

    nextPendingCommand() {
      const command = listCommands(commandsDir).find((candidate) => candidate.status === "pending");
      if (!command) return undefined;
      const leased: RecorderDebugCommand = {
        ...command,
        status: "leased",
        leasedAt: new Date().toISOString()
      };
      writeJson(commandPath(leased.id), leased);
      appendEvent({ event: "command_leased", commandId: leased.id, message: `Leased ${leased.type} debug command.` });
      return leased;
    },

    getCommand(commandId) {
      return readJson<RecorderDebugCommand>(commandPath(commandId));
    },

    markCommandResult(commandId, result) {
      const command = readJson<RecorderDebugCommand>(commandPath(commandId));
      if (!command) {
        throw new Error(`Recorder debug command not found: ${commandId}`);
      }
      const updated: RecorderDebugCommand = {
        ...command,
        status: result.ok ? "completed" : "failed",
        completedAt: new Date().toISOString(),
        result
      };
      writeJson(commandPath(commandId), updated);
      if (result.trainingReport) {
        writeJson(path.join(root, "latest-training-report.json"), result.trainingReport);
        writeJson(path.join(sessionDir(result.trainingReport.sessionId), "training-report.json"), result.trainingReport);
      }
      appendEvent({
        event: "command_completed",
        commandId,
        level: result.ok ? "success" : "error",
        sessionId: result.trainingReport?.sessionId,
        message: result.message ?? result.error ?? `${command.type} finished.`
      });
      return updated;
    }
  };
}

function toSummary(snapshot: RecorderDebugSnapshot): RecorderDebugSessionSummary {
  return {
    sessionId: snapshot.sessionId,
    timestamp: snapshot.timestamp,
    actionCount: snapshot.rawActions.length,
    preparedActionCount: snapshot.preparedActions.length,
    workflowName: snapshot.workflow?.meta.name,
    qualityScore: snapshot.quality?.score ?? snapshot.workflow?.quality?.score,
    url: snapshot.page?.url,
    title: snapshot.page?.title
  };
}

function listCommands(commandsDir: string): RecorderDebugCommand[] {
  return readdirSync(commandsDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJson<RecorderDebugCommand>(path.join(commandsDir, entry)))
    .filter((command): command is RecorderDebugCommand => Boolean(command))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^a-z0-9_.-]/gi, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Invalid recorder debug path segment: ${value}`);
  }
  return safe;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}
