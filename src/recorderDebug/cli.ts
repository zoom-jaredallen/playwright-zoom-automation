import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  RecorderDebugCommandInput,
  RecorderDebugCommandResult,
  RecorderDebugCommandType,
  RecorderDebugEvent,
  RecorderDebugSessionSummary,
  RecorderDebugSnapshot
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4174";

export function formatSnapshotSummary(snapshot: RecorderDebugSnapshot): string {
  const workflowName = snapshot.workflow?.meta.name ? `\nWorkflow: ${snapshot.workflow.meta.name}` : "";
  const quality = snapshot.quality?.score ?? snapshot.workflow?.quality?.score;
  const test = snapshot.testState.running
    ? `running${snapshot.testState.currentActionId ? ` (${snapshot.testState.currentActionId})` : ""}`
    : "idle";

  return [
    `Session: ${snapshot.sessionId}`,
    `Page: ${snapshot.page?.title ?? "unknown"}`,
    `URL: ${snapshot.page?.url ?? "unknown"}`,
    `Steps: ${snapshot.rawActions.length} raw / ${snapshot.preparedActions.length} prepared`,
    `Quality: ${quality ?? "n/a"}`,
    `Test: ${test}${workflowName}`
  ].join("\n");
}

export function buildCommandInput(command: string, args: string[]): RecorderDebugCommandInput {
  if (command === "test") {
    const from = readFlag(args, "--from");
    return from
      ? { type: "RUN_TEST_WORKFLOW_FROM", payload: { actionId: from } }
      : { type: "RUN_TEST_WORKFLOW", payload: {} };
  }

  const commandTypes: Record<string, RecorderDebugCommandType> = {
    build: "BUILD_WORKFLOW",
    actions: "GET_ACTIONS",
    state: "GET_TEST_WORKFLOW_STATE",
    clear: "CLEAR_ACTIONS"
  };
  const type = commandTypes[command];
  if (!type) {
    throw new Error(`Unsupported recorder debug command: ${command}`);
  }
  return { type, payload: {} };
}

export async function runRecorderDebugCli(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const [command = "latest", ...args] = argv;
  const baseUrl = normalizeBaseUrl(env.RECORDER_DEBUG_BASE_URL ?? DEFAULT_BASE_URL);

  if (command === "latest") {
    const snapshot = await getLatest(baseUrl);
    writeOutput(args.includes("--json") ? snapshot : formatSnapshotSummary(snapshot));
    return;
  }

  if (command === "workflow") {
    const snapshot = await getLatest(baseUrl);
    writeOutput(snapshot.workflow ?? { error: "No workflow available in latest recorder debug snapshot" });
    return;
  }

  if (command === "actions") {
    const snapshot = await getLatest(baseUrl);
    writeOutput(args.includes("--raw") ? snapshot.rawActions : snapshot.preparedActions);
    return;
  }

  if (command === "sessions") {
    writeOutput((await getJson<{ sessions: RecorderDebugSessionSummary[] }>(`${baseUrl}/api/recorder/debug/sessions`)).sessions);
    return;
  }

  if (command === "events") {
    const sessionId = readFlag(args, "--session");
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    writeOutput((await getJson<{ events: RecorderDebugEvent[] }>(`${baseUrl}/api/recorder/debug/events${query}`)).events);
    return;
  }

  if (command === "export") {
    const outPath = readFlag(args, "--out");
    if (!outPath) throw new Error("export requires --out <path>");
    const snapshot = await getLatest(baseUrl);
    if (!snapshot.workflow) throw new Error("Latest recorder debug snapshot does not include a workflow.");
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(path.resolve(outPath), `${JSON.stringify(snapshot.workflow, null, 2)}\n`, "utf8");
    writeOutput(`Exported workflow to ${path.resolve(outPath)}`);
    return;
  }

  if (command === "command") {
    const commandId = args[0];
    if (!commandId) throw new Error("command requires a command id");
    writeOutput(await getJson(`${baseUrl}/api/recorder/debug/commands/${encodeURIComponent(commandId)}`));
    return;
  }

  if (["test", "build", "clear", "state"].includes(command)) {
    const body = buildCommandInput(command, args);
    writeOutput(await postJson(`${baseUrl}/api/recorder/debug/commands`, body));
    return;
  }

  throw new Error(helpText());
}

async function getLatest(baseUrl: string): Promise<RecorderDebugSnapshot> {
  return (await getJson<{ snapshot: RecorderDebugSnapshot }>(`${baseUrl}/api/recorder/debug/latest`)).snapshot;
}

async function getJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return await response.json() as T;
}

async function postJson<T = { command: RecorderDebugCommandResult }>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return await response.json() as T;
}

function writeOutput(value: unknown): void {
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function helpText(): string {
  return [
    "Usage: npm run recorder:debug -- <command>",
    "Commands: latest, workflow, actions, sessions, events, export, test, build, clear, state, command",
    "Examples:",
    "  npm run recorder:latest",
    "  npm run recorder:test -- --from <actionId>",
    "  npm run recorder:export -- --out output/debug/workflow.json"
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecorderDebugCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
