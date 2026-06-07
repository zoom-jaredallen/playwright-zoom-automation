import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  RecorderActionDiff,
  RecorderDebugCommand,
  RecorderDebugCommandInput,
  RecorderDebugCommandResult,
  RecorderDebugCommandType,
  RecorderDebugEvent,
  RecorderDebugSessionSummary,
  RecorderDebugSnapshot,
  RecorderTrainingReport,
  RecorderWorkflowAudit
} from "./types.js";
import {
  buildWorkflowAudit,
  diffRecordedActions,
  formatTrainingReportSummary
} from "./trainingReport.js";

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

  if (command === "train") {
    return {
      type: "RUN_TRAINING_WORKFLOW",
      payload: {
        iterations: readIntFlag(args, "--iterations", 3),
        fromActionId: readFlag(args, "--from"),
        delayMs: readIntFlag(args, "--delay-ms", 1_000),
        stopOnFailure: args.includes("--stop-on-failure")
      }
    };
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

  if (command === "report") {
    const report = (await getJson<{ report: RecorderTrainingReport }>(`${baseUrl}/api/recorder/debug/training/latest`)).report;
    writeOutput(args.includes("--json") ? report : formatTrainingReportSummary(report));
    return;
  }

  if (command === "audit") {
    const snapshot = await getLatest(baseUrl);
    const audit = buildWorkflowAudit({
      rawActions: snapshot.rawActions,
      preparedActions: snapshot.preparedActions,
      qualityScore: snapshot.quality?.score ?? snapshot.workflow?.quality?.score
    });
    writeOutput(args.includes("--json") ? audit : formatAuditSummary(audit));
    return;
  }

  if (command === "diff") {
    const snapshot = await getLatest(baseUrl);
    const diff = diffRecordedActions(snapshot);
    writeOutput(args.includes("--json") ? diff : formatActionDiff(diff));
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

  if (command === "bundle") {
    const outPath = readFlag(args, "--out") ?? `output/debug/recorder-bundle-${Date.now()}`;
    const snapshot = await getLatest(baseUrl);
    const trainingReport = await getJson<{ report: RecorderTrainingReport }>(`${baseUrl}/api/recorder/debug/training/latest`)
      .then((response) => response.report)
      .catch(() => undefined);
    const audit = buildWorkflowAudit({
      rawActions: snapshot.rawActions,
      preparedActions: snapshot.preparedActions,
      qualityScore: snapshot.quality?.score ?? snapshot.workflow?.quality?.score
    });
    const diff = diffRecordedActions(snapshot);
    writeBundle(path.resolve(outPath), { snapshot, trainingReport, audit, diff });
    writeOutput(`Exported recorder debug bundle to ${path.resolve(outPath)}`);
    return;
  }

  if (command === "command") {
    const commandId = args[0];
    if (!commandId) throw new Error("command requires a command id");
    writeOutput(await getJson(`${baseUrl}/api/recorder/debug/commands/${encodeURIComponent(commandId)}`));
    return;
  }

  if (command === "wait") {
    const commandId = args[0];
    if (!commandId) throw new Error("wait requires a command id");
    writeOutput(await waitForCommand(baseUrl, commandId, {
      timeoutMs: readIntFlag(args, "--timeout-ms", 300_000),
      intervalMs: readIntFlag(args, "--interval-ms", 1_000)
    }));
    return;
  }

  if (["test", "train", "build", "clear", "state"].includes(command)) {
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

function readIntFlag(args: string[], flag: string, defaultValue: number): number {
  const raw = readFlag(args, flag);
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

async function waitForCommand(
  baseUrl: string,
  commandId: string,
  options: { timeoutMs: number; intervalMs: number }
): Promise<{ command: RecorderDebugCommand }> {
  const started = Date.now();
  while (Date.now() - started <= options.timeoutMs) {
    const response = await getJson<{ command: RecorderDebugCommand }>(`${baseUrl}/api/recorder/debug/commands/${encodeURIComponent(commandId)}`);
    if (["completed", "failed"].includes(response.command.status)) {
      return response;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(`Timed out waiting for recorder debug command ${commandId}`);
}

function writeBundle(
  outDir: string,
  input: {
    snapshot: RecorderDebugSnapshot;
    trainingReport?: RecorderTrainingReport;
    audit: RecorderWorkflowAudit;
    diff: RecorderActionDiff;
  }
): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "snapshot.json"), `${JSON.stringify(input.snapshot, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "raw-actions.json"), `${JSON.stringify(input.snapshot.rawActions, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "prepared-actions.json"), `${JSON.stringify(input.snapshot.preparedActions, null, 2)}\n`, "utf8");
  if (input.snapshot.workflow) {
    writeFileSync(path.join(outDir, "workflow.json"), `${JSON.stringify(input.snapshot.workflow, null, 2)}\n`, "utf8");
  }
  if (input.trainingReport) {
    writeFileSync(path.join(outDir, "training-report.json"), `${JSON.stringify(input.trainingReport, null, 2)}\n`, "utf8");
  }
  writeFileSync(path.join(outDir, "audit.json"), `${JSON.stringify(input.audit, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "action-diff.json"), `${JSON.stringify(input.diff, null, 2)}\n`, "utf8");
}

function formatAuditSummary(audit: RecorderWorkflowAudit): string {
  return [
    `Workflow audit score: ${audit.score}`,
    `Risky steps: ${audit.riskySteps.length}`,
    audit.riskySteps.slice(0, 5).map((step) => `- ${step.actionId}: ${step.reasons.join(", ")}`).join("\n"),
    `Recommendations: ${audit.recommendations.length}`
  ].filter(Boolean).join("\n");
}

function formatActionDiff(diff: RecorderActionDiff): string {
  return [
    `Raw steps: ${diff.rawCount}`,
    `Prepared steps: ${diff.preparedCount}`,
    `Removed steps: ${diff.removed.length}`,
    ...diff.removed.slice(0, 10).map((step) => `- ${step.id} ${step.type}${step.description ? `: ${step.description}` : ""}`)
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function helpText(): string {
  return [
    "Usage: npm run recorder:debug -- <command>",
    "Commands: latest, workflow, actions, sessions, events, export, test, train, wait, report, audit, diff, bundle, build, clear, state, command",
    "Examples:",
    "  npm run recorder:latest",
    "  npm run recorder:test -- --from <actionId>",
    "  npm run recorder:train -- --iterations 3",
    "  npm run recorder:export -- --out output/debug/workflow.json"
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecorderDebugCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
