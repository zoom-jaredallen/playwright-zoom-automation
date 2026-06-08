import type { ExtensionMessage, RecordedAction, RecordedWorkflow, WorkflowTestEvent } from "../shared/types.js";
import type {
  RecorderDebugCommand,
  RecorderDebugCommandResult,
  RecorderTrainingIteration
} from "../shared/debugBridge.js";
import { boundedPositiveInteger, buildExtensionTrainingReport } from "./trainingReport.js";
import { ensureContentRecorder, getActiveTab, sleep } from "./chromeTabUtils.js";
import { isRecordedAction, validateImportWorkflow } from "./workflowImport.js";

export interface RecorderDebugRuntime {
  startRecording(message: Extract<ExtensionMessage, { type: "START_RECORDING" }>): Promise<{ ok: boolean; error?: string }>;
  stopRecording(message: Extract<ExtensionMessage, { type: "STOP_RECORDING" }>): Promise<{ ok: boolean; workflow?: RecordedWorkflow; error?: string }>;
  availableActions(options: { restore: boolean }): Promise<RecordedAction[]>;
  buildWorkflow(): RecordedWorkflow;
  loadLastWorkflow(): Promise<RecordedWorkflow | undefined>;
  persistLastWorkflow(workflow: RecordedWorkflow, workflowActions: RecordedAction[]): Promise<void>;
  setActions(actions: RecordedAction[]): void;
  importWorkflow(workflow: RecordedWorkflow): Promise<{ ok: boolean; error?: string }>;
  startTestWorkflow(planOptions: { mode: "full" | "from"; actionId?: string; trusted?: boolean }): Promise<{ ok: boolean; error?: string }>;
  waitForDebugTestCompletion(): Promise<void>;
  hasDebugTestError(): boolean;
  currentTestState(): { running: boolean; currentActionId?: string; events: WorkflowTestEvent[] };
  getTestEvents(): WorkflowTestEvent[];
  startTestAction(action: RecordedAction): Promise<{ ok: boolean; error?: string }>;
  clearRecordedActions(): Promise<void>;
  currentRecorderDebugSessionId(workflow?: RecordedWorkflow): string;
}

export async function executeRecorderDebugCommand(
  command: RecorderDebugCommand,
  runtime: RecorderDebugRuntime
): Promise<RecorderDebugCommandResult> {
  try {
    switch (command.type) {
      case "START_RECORDING": {
        const started = await runtime.startRecording({ type: "START_RECORDING" });
        return started.ok
          ? { ok: true, message: "Recorder started." }
          : { ok: false, error: started.error };
      }

      case "STOP_RECORDING": {
        const stopped = await runtime.stopRecording({ type: "STOP_RECORDING" });
        return stopped.ok
          ? {
              ok: true,
              message: `Recorder stopped with ${stopped.workflow?.actions.length ?? 0} step(s).`,
              workflow: stopped.workflow
            }
          : { ok: false, error: stopped.error };
      }

      case "RELOAD_EXTENSION":
        return { ok: true, message: "Extension reload scheduled." };

      case "BUILD_WORKFLOW": {
        const available = await runtime.availableActions({ restore: true });
        const workflow = available.length > 0 ? runtime.buildWorkflow() : await runtime.loadLastWorkflow();
        if (!workflow) return { ok: false, error: "No recorder actions are available to build a workflow." };
        runtime.setActions(workflow.actions);
        await runtime.persistLastWorkflow(workflow, workflow.actions);
        return { ok: true, message: `Built workflow with ${workflow.actions.length} step(s).`, workflow };
      }

      case "IMPORT_WORKFLOW": {
        const workflow = debugCommandWorkflow(command);
        if (!workflow) return { ok: false, error: "IMPORT_WORKFLOW requires payload.workflow" };
        const imported = await runtime.importWorkflow(workflow);
        return imported.ok
          ? { ok: true, message: `Imported workflow with ${workflow.actions.length} step(s).`, workflow }
          : { ok: false, error: imported.error };
      }

      case "GET_ACTIONS": {
        const available = await runtime.availableActions({ restore: true });
        return {
          ok: true,
          message: `${available.length} recorder action(s) available.`,
          actions: available,
          workflow: available.length > 0 ? runtime.buildWorkflow() : await runtime.loadLastWorkflow()
        };
      }

      case "GET_TEST_WORKFLOW_STATE":
        return { ok: true, testState: runtime.currentTestState(), events: runtime.getTestEvents() };

      case "RUN_TEST_WORKFLOW":
        return await runDebugTestWorkflow(runtime, { mode: "full" }, "Browser workflow test finished.");

      case "RUN_TRUSTED_TEST_WORKFLOW":
        return await runDebugTestWorkflow(runtime, { mode: "full", trusted: true }, "Trusted browser workflow test finished.");

      case "IMPORT_AND_RUN_TEST_WORKFLOW":
        return await importAndRunDebugWorkflow(command, runtime, { mode: "full", trusted: false }, "Imported workflow and browser test finished.");

      case "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW":
        return await importAndRunDebugWorkflow(command, runtime, { mode: "full", trusted: true }, "Imported workflow and trusted browser test finished.");

      case "IMPORT_AND_RUN_TEST_WORKFLOW_FROM":
        return await importAndRunFromDebugWorkflow(command, runtime, false);

      case "IMPORT_AND_RUN_TRUSTED_TEST_WORKFLOW_FROM":
        return await importAndRunFromDebugWorkflow(command, runtime, true);

      case "RUN_TEST_WORKFLOW_FROM": {
        const actionId = typeof command.payload?.actionId === "string" ? command.payload.actionId : undefined;
        if (!actionId) return { ok: false, error: "RUN_TEST_WORKFLOW_FROM requires payload.actionId" };
        return await runDebugTestWorkflow(runtime, { mode: "from", actionId }, "Browser workflow test finished.");
      }

      case "RUN_TRUSTED_TEST_WORKFLOW_FROM": {
        const actionId = typeof command.payload?.actionId === "string" ? command.payload.actionId : undefined;
        if (!actionId) return { ok: false, error: "RUN_TRUSTED_TEST_WORKFLOW_FROM requires payload.actionId" };
        return await runDebugTestWorkflow(runtime, { mode: "from", actionId, trusted: true }, "Trusted browser workflow test finished.");
      }

      case "RUN_TEST_ACTION": {
        const action = await resolveDebugCommandAction(command, runtime);
        if (!action) return { ok: false, error: "RUN_TEST_ACTION requires payload.actionId or payload.action" };
        const result = await runtime.startTestAction(action);
        return {
          ok: result.ok,
          message: result.ok ? `Step test finished: ${action.description ?? action.type}` : undefined,
          error: result.error,
          testState: runtime.currentTestState(),
          events: runtime.getTestEvents()
        };
      }

      case "TEST_SELECTOR": {
        const action = await resolveDebugCommandAction(command, runtime);
        if (!action) return { ok: false, error: "TEST_SELECTOR requires payload.actionId or payload.action" };
        const tab = await getActiveTab().catch(() => undefined);
        if (!tab?.id) return { ok: false, error: "No active tab is available for selector diagnostics." };
        await ensureContentRecorder(tab.id);
        const diagnostic = await chrome.tabs.sendMessage(tab.id, { type: "TEST_SELECTOR", action } satisfies ExtensionMessage);
        return {
          ok: !diagnostic?.error,
          message: diagnostic?.error ? undefined : `Selector diagnostic finished: ${action.description ?? action.type}`,
          error: diagnostic?.error,
          diagnostic
        };
      }

      case "RUN_TRAINING_WORKFLOW":
        return await runTrainingWorkflow(command, runtime);

      case "CLEAR_ACTIONS":
        await runtime.clearRecordedActions();
        return { ok: true, message: "Recorder actions cleared." };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), testState: runtime.currentTestState(), events: runtime.getTestEvents() };
  }
}

function debugCommandWorkflow(command: RecorderDebugCommand): RecordedWorkflow | undefined {
  const workflow = command.payload?.workflow;
  if (!workflow || typeof workflow !== "object") return undefined;
  const validation = validateImportWorkflow(workflow as RecordedWorkflow);
  return validation ? undefined : workflow as RecordedWorkflow;
}

async function resolveDebugCommandAction(command: RecorderDebugCommand, runtime: RecorderDebugRuntime): Promise<RecordedAction | undefined> {
  const payloadAction = command.payload?.action;
  if (isRecordedAction(payloadAction)) return payloadAction;

  const actionId = typeof command.payload?.actionId === "string" ? command.payload.actionId : undefined;
  if (!actionId) return undefined;

  const available = await runtime.availableActions({ restore: true });
  const workflow = available.length > 0 ? undefined : await runtime.loadLastWorkflow();
  return available.find((action) => action.id === actionId)
    ?? workflow?.actions.find((action) => action.id === actionId);
}

async function runDebugTestWorkflow(
  runtime: RecorderDebugRuntime,
  planOptions: { mode: "full" | "from"; actionId?: string; trusted?: boolean },
  message: string
): Promise<RecorderDebugCommandResult> {
  const started = await runtime.startTestWorkflow(planOptions);
  if (!started.ok) return { ok: false, error: started.error, testState: runtime.currentTestState(), events: runtime.getTestEvents() };
  await runtime.waitForDebugTestCompletion();
  return { ok: !runtime.hasDebugTestError(), message, testState: runtime.currentTestState(), events: runtime.getTestEvents() };
}

async function importAndRunDebugWorkflow(
  command: RecorderDebugCommand,
  runtime: RecorderDebugRuntime,
  options: { mode: "full"; trusted: boolean },
  message: string
): Promise<RecorderDebugCommandResult> {
  const workflow = debugCommandWorkflow(command);
  if (!workflow) return { ok: false, error: `${command.type} requires payload.workflow` };
  const imported = await runtime.importWorkflow(workflow);
  if (!imported.ok) return { ok: false, error: imported.error, testState: runtime.currentTestState(), events: runtime.getTestEvents() };
  const started = await runtime.startTestWorkflow(options);
  if (!started.ok) return { ok: false, error: started.error, testState: runtime.currentTestState(), events: runtime.getTestEvents(), workflow };
  await runtime.waitForDebugTestCompletion();
  return { ok: !runtime.hasDebugTestError(), message, workflow, testState: runtime.currentTestState(), events: runtime.getTestEvents() };
}

async function importAndRunFromDebugWorkflow(
  command: RecorderDebugCommand,
  runtime: RecorderDebugRuntime,
  trusted: boolean
): Promise<RecorderDebugCommandResult> {
  const workflow = debugCommandWorkflow(command);
  const actionId = typeof command.payload?.actionId === "string" ? command.payload.actionId : undefined;
  if (!workflow) return { ok: false, error: `${command.type} requires payload.workflow` };
  if (!actionId) return { ok: false, error: `${command.type} requires payload.actionId` };
  const imported = await runtime.importWorkflow(workflow);
  if (!imported.ok) return { ok: false, error: imported.error, testState: runtime.currentTestState(), events: runtime.getTestEvents() };
  const started = await runtime.startTestWorkflow({ mode: "from", actionId, trusted });
  if (!started.ok) return { ok: false, error: started.error, testState: runtime.currentTestState(), events: runtime.getTestEvents(), workflow };
  await runtime.waitForDebugTestCompletion();
  return {
    ok: !runtime.hasDebugTestError(),
    message: trusted ? "Imported workflow and trusted browser test finished." : "Imported workflow and browser test finished.",
    workflow,
    testState: runtime.currentTestState(),
    events: runtime.getTestEvents()
  };
}

async function runTrainingWorkflow(command: RecorderDebugCommand, runtime: RecorderDebugRuntime): Promise<RecorderDebugCommandResult> {
  const available = await runtime.availableActions({ restore: true });
  const workflow = available.length > 0 ? runtime.buildWorkflow() : await runtime.loadLastWorkflow();
  const trainingActions = workflow?.actions ?? available;
  if (trainingActions.length === 0) {
    return { ok: false, error: "No recorder actions are available for training." };
  }

  const iterations = boundedPositiveInteger(command.payload?.iterations, 3, 20);
  const delayMs = boundedPositiveInteger(command.payload?.delayMs, 1_000, 60_000);
  const fromActionId = typeof command.payload?.fromActionId === "string" ? command.payload.fromActionId : undefined;
  const stopOnFailure = command.payload?.stopOnFailure === true;
  const startedAt = new Date().toISOString();
  const results: RecorderTrainingIteration[] = [];

  for (let index = 1; index <= iterations; index += 1) {
    const iterationStarted = Date.now();
    const started = await runtime.startTestWorkflow(fromActionId ? { mode: "from", actionId: fromActionId } : { mode: "full" });
    if (!started.ok) {
      results.push({
        index,
        ok: false,
        durationMs: Date.now() - iterationStarted,
        error: started.error,
        events: runtime.getTestEvents()
      });
      if (stopOnFailure) break;
      await sleep(delayMs);
      continue;
    }

    await runtime.waitForDebugTestCompletion();
    const iterationEvents = runtime.getTestEvents();
    const failure = [...iterationEvents].reverse().find((event) => event.level === "error");
    results.push({
      index,
      ok: !failure,
      durationMs: Date.now() - iterationStarted,
      failedActionId: failure?.actionId,
      error: failure?.message,
      events: iterationEvents
    });
    if (failure && stopOnFailure) break;
    if (index < iterations) await sleep(delayMs);
  }

  const report = buildExtensionTrainingReport({
    sessionId: runtime.currentRecorderDebugSessionId(workflow),
    workflowName: workflow?.meta.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    actions: trainingActions,
    iterations: results,
    qualityScore: workflow?.quality?.score
  });
  return {
    ok: report.summary.failed === 0,
    message: `Training finished: ${report.summary.passed}/${report.summary.iterations} iteration(s) passed.`,
    workflow,
    trainingReport: report,
    testState: runtime.currentTestState(),
    events: runtime.getTestEvents()
  };
}
