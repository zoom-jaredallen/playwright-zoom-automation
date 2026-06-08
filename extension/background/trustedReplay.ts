import type { ExtensionMessage, RecordedAction, ReplayTargetResult, WorkflowTestEvent } from "../shared/types.js";
import { sleep, type TestTab } from "./chromeTabUtils.js";
import { waitForTestPageReady } from "./navigationPreflight.js";

export interface TrustedReplayContext {
  pushTestEvent(level: WorkflowTestEvent["level"], message: string, actionId?: string): void;
  executeTestActionWithPolicy(tab: chrome.tabs.Tab, action: RecordedAction): Promise<{ skipped?: boolean; message?: string }>;
}

export async function executeTrustedTestActionWithPolicy(
  tab: TestTab,
  action: RecordedAction,
  session: TrustedInputSession,
  context: TrustedReplayContext
): Promise<{ skipped?: boolean; message?: string }> {
  if (!isTrustedReplayAction(action)) {
    return await context.executeTestActionWithPolicy(tab, action);
  }

  const retryBudget = Math.max(action.retryCount ?? 0, action.onFailure === "retry" ? 1 : 0);
  const attempts = retryBudget + 1;
  const retryDelayMs = action.retryDelayMs ?? 1_000;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await executeTrustedTestAction(tab, action, session, context);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        context.pushTestEvent("info", `Trusted retry ${attempt}/${attempts - 1}: ${lastError}`, action.id);
        await sleep(retryDelayMs);
      }
    }
  }

  if (action.screenshotOnFailure || action.onFailure === "screenshot") {
    await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
    context.pushTestEvent("info", "Failure screenshot captured.", action.id);
  }
  if (action.continueOnFailure || action.onFailure === "skip") {
    context.pushTestEvent("error", `Continuing after trusted failure: ${lastError}`, action.id);
    return { skipped: true, message: lastError };
  }
  throw new Error(lastError ?? `Trusted step failed: ${action.description ?? action.type}`);
}

export class TrustedInputSession {
  private attached = true;

  private constructor(private readonly tabId: number) {}

  static async attach(tabId: number): Promise<TrustedInputSession> {
    const session = new TrustedInputSession(tabId);
    await chrome.debugger.attach({ tabId }, "1.3");
    return session;
  }

  async click(x: number, y: number): Promise<void> {
    await this.dispatch("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      pointerType: "mouse"
    });
    await this.dispatch("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse"
    });
    await sleep(80);
    await this.dispatch("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse"
    });
  }

  async fill(value: string): Promise<void> {
    await this.selectAll();
    await this.pressKey({
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8
    });
    await this.pressKey({
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8
    });
    if (value) {
      await this.dispatch("Input.insertText", { text: value });
    }
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached = false;
    await chrome.debugger.detach({ tabId: this.tabId });
  }

  private async selectAll(): Promise<void> {
    await this.dispatch("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Meta",
      code: "MetaLeft",
      windowsVirtualKeyCode: 91,
      modifiers: 4
    });
    await this.dispatch("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 4
    });
    await this.dispatch("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 4
    });
    await this.dispatch("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Meta",
      code: "MetaLeft",
      windowsVirtualKeyCode: 91,
      modifiers: 0
    });
  }

  private async pressKey(params: Record<string, unknown>): Promise<void> {
    await this.dispatch("Input.dispatchKeyEvent", params);
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<void> {
    if (!this.attached) throw new Error("Trusted Chrome input session is not attached.");
    await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
  }
}

function isTrustedReplayAction(action: RecordedAction): boolean {
  return action.type === "click" || action.type === "fill" || action.type === "select";
}

async function executeTrustedTestAction(
  tab: TestTab,
  action: RecordedAction,
  session: TrustedInputSession,
  context: TrustedReplayContext
): Promise<{ skipped?: boolean; message?: string }> {
  if (action.type === "click") {
    const target = await locateReplayTarget(tab.id, action);
    context.pushTestEvent("info", trustedTargetMessage("Trusted click target", target), action.id);
    await session.click(target.rect!.centerX, target.rect!.centerY);
    await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
    return {};
  }

  if (action.type === "fill") {
    const target = await locateReplayTarget(tab.id, action);
    const value = resolveTrustedActionValue(action);
    context.pushTestEvent("info", `${trustedTargetMessage("Trusted fill target", target)} with "${value}"`, action.id);
    await session.click(target.rect!.centerX, target.rect!.centerY);
    await session.fill(value);
    await sleep(750);
    return {};
  }

  if (action.type === "select") {
    const target = await locateReplayTarget(tab.id, action);
    context.pushTestEvent("info", trustedTargetMessage("Trusted select trigger", target), action.id);
    await session.click(target.rect!.centerX, target.rect!.centerY);
    await sleep(500);

    const optionText = action.selectMetadata?.optionLabel ?? resolveTrustedActionValue(action);
    if (!optionText.trim()) {
      throw new Error("Trusted select step has no option text.");
    }
    const option = await locateReplayOption(tab.id, action, optionText);
    context.pushTestEvent("info", trustedTargetMessage(`Trusted select option "${optionText}"`, option), action.id);
    await session.click(option.rect!.centerX, option.rect!.centerY);
    await sleep(500);

    const verified = await chrome.tabs.sendMessage(tab.id, {
      type: "VERIFY_TEST_ACTION_SELECT",
      action,
      expected: action.selectMetadata?.verificationText ?? optionText
    } satisfies ExtensionMessage) as { ok?: boolean; error?: string };
    if (!verified?.ok) {
      throw new Error(verified?.error ?? `Trusted select step did not apply "${optionText}".`);
    }
    await waitForTestPageReady(tab.id, action.timeout ?? 10_000);
    return {};
  }

  return await context.executeTestActionWithPolicy(tab, action);
}

function trustedTargetMessage(prefix: string, target: ReplayTargetResult & { rect: NonNullable<ReplayTargetResult["rect"]> }): string {
  const rect = target.rect;
  return `${prefix}: ${target.preview ?? target.text ?? "element"} at (${Math.round(rect.centerX)}, ${Math.round(rect.centerY)})`;
}

async function locateReplayTarget(tabId: number, action: RecordedAction): Promise<ReplayTargetResult & { rect: NonNullable<ReplayTargetResult["rect"]> }> {
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "LOCATE_TEST_ACTION_TARGET",
    action
  } satisfies ExtensionMessage) as ReplayTargetResult;
  return requireReplayTarget(result, action.description ?? action.type);
}

async function locateReplayOption(
  tabId: number,
  action: RecordedAction,
  optionText: string
): Promise<ReplayTargetResult & { rect: NonNullable<ReplayTargetResult["rect"]> }> {
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "LOCATE_TEST_ACTION_OPTION",
    action,
    optionText
  } satisfies ExtensionMessage) as ReplayTargetResult;
  return requireReplayTarget(result, `option "${optionText}"`);
}

function requireReplayTarget(
  result: ReplayTargetResult | undefined,
  label: string
): ReplayTargetResult & { rect: NonNullable<ReplayTargetResult["rect"]> } {
  if (!result?.ok || !result.rect) {
    throw new Error(result?.error ?? `Could not locate trusted replay target for ${label}.`);
  }
  return result as ReplayTargetResult & { rect: NonNullable<ReplayTargetResult["rect"]> };
}

function resolveTrustedActionValue(action: RecordedAction): string {
  const value = action.value ?? "";
  if (!value.includes("{{") || !action.parameterHints?.length) return value;

  return value.replace(/\{\{([^}]+)\}\}/g, (placeholder, rawName) => {
    const paramName = String(rawName).trim();
    const hint = action.parameterHints?.find(
      (candidate) => candidate.confirmed !== false && candidate.suggestedName === paramName
    );
    return hint?.originalValue ?? placeholder;
  });
}
