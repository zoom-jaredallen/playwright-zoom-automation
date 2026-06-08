import type { ExtensionMessage, RecordedAction, WorkflowTestEvent } from "../shared/types.js";
import { createStepTestPlan } from "../shared/testPlan.js";
import { ensureContentRecorder, getActiveTab, sleep, type TestTab } from "./chromeTabUtils.js";
import { evaluatePreflightNavigation, waitForPreflightNavigation, waitForTestPageReady } from "./navigationPreflight.js";
import { executeTrustedTestActionWithPolicy, TrustedInputSession } from "./trustedReplay.js";

export interface WorkflowTestRunnerOptions {
  ensureHydrated(): Promise<void>;
  isRecording(): boolean;
  availableActions(options: { restore: boolean }): Promise<RecordedAction[]>;
  onStateChanged(): void;
}

export class WorkflowTestRunner {
  private running = false;
  private currentActionId: string | undefined;
  private events: WorkflowTestEvent[] = [];

  constructor(private readonly options: WorkflowTestRunnerOptions) {}

  async startWorkflow(planOptions: { mode: "full" | "from"; actionId?: string; trusted?: boolean }): Promise<{ ok: boolean; error?: string }> {
    await this.options.ensureHydrated();
    if (this.running) return { ok: true };
    if (this.options.isRecording()) {
      this.pushEvent("error", "Stop recording before running a test.");
      return { ok: false, error: "Stop recording before running a test." };
    }

    const available = await this.options.availableActions({ restore: true });
    const testPlan = createStepTestPlan(available, planOptions);
    const testActions = testPlan.actions;
    if (testActions.length === 0) {
      this.pushEvent("error", "No workflow steps are available to test.");
      return { ok: false, error: "No workflow steps are available to test." };
    }

    const tab = await getActiveTab().catch(() => undefined);
    if (!tab?.id) {
      this.pushEvent("error", "No active tab is available for testing.");
      return { ok: false, error: "No active tab is available for testing." };
    }

    this.running = true;
    this.currentActionId = undefined;
    this.events = [];
    const modeLabel = planOptions.trusted ? `${testPlan.mode} trusted browser test` : `${testPlan.mode} browser test`;
    this.pushEvent("info", `Starting ${modeLabel} with ${testActions.length} step(s).`);
    void this.runWorkflow(testActions, tab as TestTab, { trusted: Boolean(planOptions.trusted) });
    return { ok: true };
  }

  async startAction(action: RecordedAction): Promise<{ ok: boolean; error?: string }> {
    await this.options.ensureHydrated();
    if (this.running) return { ok: false, error: "A test is already running." };
    if (this.options.isRecording()) {
      this.pushEvent("error", "Stop recording before testing a step.", action.id);
      return { ok: false, error: "Stop recording before testing a step." };
    }

    const tab = await getActiveTab().catch(() => undefined);
    if (!tab?.id) {
      this.pushEvent("error", "No active tab is available for testing.", action.id);
      return { ok: false, error: "No active tab is available for testing." };
    }

    this.running = true;
    this.currentActionId = action.id;
    this.events = [];
    this.broadcastState();
    this.pushEvent("info", `Testing step: ${action.description ?? action.type}`, action.id);

    try {
      await this.runSingleAction(action, tab as TestTab);
      this.pushEvent("success", `Passed: ${action.description ?? action.type}`, action.id);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent("error", message, action.id);
      return { ok: false, error: message };
    } finally {
      this.running = false;
      this.currentActionId = undefined;
      this.broadcastState();
    }
  }

  stop(): void {
    this.running = false;
    this.currentActionId = undefined;
    this.broadcastState();
  }

  currentState(): { running: boolean; currentActionId?: string; events: WorkflowTestEvent[] } {
    return {
      running: this.running,
      currentActionId: this.currentActionId,
      events: [...this.events]
    };
  }

  getEvents(): WorkflowTestEvent[] {
    return [...this.events];
  }

  hasError(): boolean {
    return this.events.some((event) => event.level === "error");
  }

  async waitForCompletion(): Promise<void> {
    const started = Date.now();
    while (this.running && Date.now() - started < 5 * 60_000) {
      await sleep(500);
    }
    if (this.running) {
      throw new Error("Timed out waiting for browser workflow test to finish.");
    }
  }

  pushEvent(level: WorkflowTestEvent["level"], message: string, actionId?: string): void {
    this.events.push({ timestamp: Date.now(), level, message, actionId });
    this.broadcastState();
  }

  private async runWorkflow(testActions: RecordedAction[], tab: TestTab, options: { trusted?: boolean } = {}): Promise<void> {
    let trustedSession: TrustedInputSession | undefined;
    try {
      if (options.trusted) {
        trustedSession = await TrustedInputSession.attach(tab.id);
        this.pushEvent("info", "Trusted Chrome input session attached.");
      }

      for (const action of testActions) {
        this.currentActionId = action.id;
        this.broadcastState();
        this.pushEvent("info", `Step: ${action.description ?? action.type}`, action.id);

        const result = await this.runSingleAction(action, tab, { trustedSession });
        if (result.stopWorkflow) break;
        if (result.skipped && action.condition?.type === "addressAlreadyExistsSkipAccount") {
          this.pushEvent("success", "Account-level skip condition met; test stopped.", action.id);
          break;
        }
        this.pushEvent("success", `Passed: ${action.description ?? action.type}`, action.id);
      }
      this.pushEvent("success", "Browser test completed.");
    } catch (error) {
      this.pushEvent("error", error instanceof Error ? error.message : String(error), this.currentActionId);
    } finally {
      await trustedSession?.detach().catch((error) => {
        this.pushEvent("error", `Trusted Chrome input session detach failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.running = false;
      this.currentActionId = undefined;
      this.broadcastState();
    }
  }

  private async runSingleAction(
    action: RecordedAction,
    tab: TestTab,
    options: { trustedSession?: TrustedInputSession } = {}
  ): Promise<{ skipped?: boolean; stopWorkflow?: boolean }> {
    if (action.type === "navigate") {
      const result = await evaluatePreflightNavigation(tab.id, action);
      this.pushEvent("info", result.message, action.id);
      if (result.navigated && result.targetUrl) {
        await waitForPreflightNavigation(tab.id, result.targetUrl);
        await ensureContentRecorder(tab.id);
      }
      await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
      return { skipped: !result.navigated };
    }

    if (action.type === "screenshot") {
      await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
      await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      this.pushEvent("success", `Screenshot captured: ${action.screenshotLabel ?? "evidence"}`, action.id);
      return {};
    }

    await ensureContentRecorder(tab.id);
    const result = options.trustedSession
      ? await executeTrustedTestActionWithPolicy(tab, action, options.trustedSession, {
          pushTestEvent: (level, message, actionId) => this.pushEvent(level, message, actionId),
          executeTestActionWithPolicy: (targetTab, targetAction) => this.executeActionWithPolicy(targetTab, targetAction)
        })
      : await this.executeActionWithPolicy(tab, action);
    if (result.skipped) {
      this.pushEvent("info", result.message ?? `Skipped: ${action.description ?? action.type}`, action.id);
      return { skipped: true, stopWorkflow: action.condition?.type === "addressAlreadyExistsSkipAccount" };
    }
    return {};
  }

  private async executeActionWithPolicy(tab: chrome.tabs.Tab, action: RecordedAction): Promise<{ skipped?: boolean; message?: string }> {
    const retryBudget = Math.max(action.retryCount ?? 0, action.onFailure === "retry" ? 1 : 0);
    const attempts = retryBudget + 1;
    const retryDelayMs = action.retryDelayMs ?? 1_000;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await chrome.tabs.sendMessage(tab.id!, { type: "EXECUTE_TEST_ACTION", action } satisfies ExtensionMessage);
      if (result?.ok) return { skipped: Boolean(result.skipped), message: result.message };

      lastError = result?.error ?? `Step failed: ${action.description ?? action.type}`;
      if (attempt < attempts) {
        this.pushEvent("info", `Retry ${attempt}/${attempts - 1}: ${lastError}`, action.id);
        await sleep(retryDelayMs);
      }
    }

    if (action.screenshotOnFailure || action.onFailure === "screenshot") {
      await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
      this.pushEvent("info", "Failure screenshot captured.", action.id);
    }
    if (action.continueOnFailure || action.onFailure === "skip") {
      this.pushEvent("error", `Continuing after failure: ${lastError}`, action.id);
      return { skipped: true, message: lastError };
    }
    throw new Error(lastError ?? `Step failed: ${action.description ?? action.type}`);
  }

  private broadcastState(): void {
    chrome.runtime.sendMessage({
      type: "TEST_WORKFLOW_STATE_UPDATED",
      running: this.running,
      currentActionId: this.currentActionId,
      events: this.events
    } satisfies ExtensionMessage).catch(() => undefined);
    this.options.onStateChanged();
  }
}
