/**
 * Pure, framework-agnostic mutation model for recorded workflows. The extension
 * service-worker and the Web UI both drive these functions so step edits behave
 * identically. All array operations return a new array (no in-place mutation of
 * the caller's reference beyond the contained action objects).
 */
import {
  extractParameters,
  generateAssertions,
  generateDescription,
  inferCategory,
  calculateQualityReport,
  replaceWithPlaceholders
} from "./analysis.js";
import type { AssertionType, OnFailure, RecordedAction, RecordedWorkflow, StepCondition } from "./types.js";

// ─── ID + URL helpers ───────────────────────────────────────────────────────────

export function createManualActionId(prefix?: string): string {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `manual_${prefix}_${suffix}` : `manual_${suffix}`;
}

export function normalizeNavigationUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("/")) {
    return `https://zoom.us${value}`;
  }
  if (value.startsWith("#")) {
    return `https://zoom.us/cpw/page/phoneNumbers${value}`;
  }
  return `https://zoom.us/${value.replace(/^\/+/, "")}`;
}

// ─── Manual step factories ──────────────────────────────────────────────────────

export function makeNavigationAction(rawUrl: string): RecordedAction {
  const url = normalizeNavigationUrl(rawUrl);
  return {
    id: createManualActionId(),
    timestamp: Date.now(),
    type: "navigate",
    selectors: {},
    url,
    pageUrl: url,
    pageTitle: "Manual navigation",
    description: `Navigate to ${url}`
  };
}

export function makeAssertionAction(
  assertionType: AssertionType | undefined,
  expected: string,
  startUrl = "",
  timeout = 10_000,
  onFailure: OnFailure = "screenshot"
): RecordedAction {
  const normalizedType: AssertionType = assertionType ?? "textVisible";
  return {
    id: createManualActionId("assert"),
    timestamp: Date.now(),
    type: "assert",
    selectors: {},
    assertionType: normalizedType,
    expected: expected.trim(),
    timeout,
    onFailure,
    pageUrl: startUrl,
    pageTitle: "Manual assertion",
    description: `Assert ${formatAssertionType(normalizedType)}: ${expected.trim()}`
  };
}

export function makeScreenshotAction(label?: string, startUrl = ""): RecordedAction {
  const normalizedLabel = label?.trim() || "evidence";
  return {
    id: createManualActionId("screenshot"),
    timestamp: Date.now(),
    type: "screenshot",
    selectors: {},
    screenshotLabel: normalizedLabel,
    pageUrl: startUrl,
    pageTitle: "Manual screenshot",
    description: `Take screenshot: ${normalizedLabel}`
  };
}

export function makeWaitAction(waitMs: number, startUrl = ""): RecordedAction {
  const normalizedWaitMs = clamp(waitMs, 250, 60_000);
  return {
    id: createManualActionId("wait"),
    timestamp: Date.now(),
    type: "wait",
    selectors: {},
    waitMs: normalizedWaitMs,
    pageUrl: startUrl,
    pageTitle: "Manual wait",
    description: `Wait ${normalizedWaitMs}ms`
  };
}

export function makeDialogAction(
  dialogAction: NonNullable<RecordedAction["dialogAction"]>,
  promptText?: string,
  startUrl = ""
): RecordedAction {
  return {
    id: createManualActionId("dialog"),
    timestamp: Date.now(),
    type: "dialog",
    selectors: {},
    dialogAction,
    dialogPromptText: promptText?.trim() || undefined,
    pageUrl: startUrl,
    pageTitle: "Manual dialog handler",
    description: `${dialogAction === "accept" ? "Accept" : "Dismiss"} next native dialog`
  };
}

// ─── Array operations ─────────────────────────────────────────────────────────

export function insertStep(actions: RecordedAction[], action: RecordedAction, insertAfterActionId?: string | null): RecordedAction[] {
  const next = [...actions];
  if (insertAfterActionId === null) {
    next.unshift(action);
    return next;
  }
  if (insertAfterActionId) {
    const index = next.findIndex((candidate) => candidate.id === insertAfterActionId);
    if (index >= 0) {
      next.splice(index + 1, 0, action);
      return next;
    }
  }
  next.push(action);
  return next;
}

export function moveStep(actions: RecordedAction[], actionId: string, direction: "up" | "down"): RecordedAction[] {
  const currentIndex = actions.findIndex((action) => action.id === actionId);
  if (currentIndex === -1) return actions;
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= actions.length) return actions;

  const next = [...actions];
  const [action] = next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, action);
  return next;
}

export function deleteStep(actions: RecordedAction[], actionId: string): RecordedAction[] {
  return actions.filter((action) => action.id !== actionId);
}

export interface StepUpdate {
  description?: string;
  cssSelector?: string;
  selectorNote?: string;
  url?: string;
  assertionType?: RecordedAction["assertionType"];
  expected?: string;
  timeout?: number;
  onFailure?: RecordedAction["onFailure"];
  retryCount?: number;
  retryDelayMs?: number;
  continueOnFailure?: boolean;
  screenshotOnFailure?: boolean;
  condition?: StepCondition;
  screenshotLabel?: string;
  waitMs?: number;
  networkWaitUrl?: string;
  waitForUrl?: string;
  key?: string;
  dialogAction?: RecordedAction["dialogAction"];
  dialogPromptText?: string;
  elementScreenshot?: boolean;
}

/**
 * Apply an in-place style update to a single action and return a new action.
 * Mirrors the field validation/clamping the extension service-worker performs.
 */
export function applyStepUpdate(original: RecordedAction, update: StepUpdate): RecordedAction {
  const action: RecordedAction = { ...original, selectors: { ...original.selectors } };

  if (update.description !== undefined) {
    action.description = update.description;
  }
  if (update.cssSelector !== undefined) {
    const cssSelector = update.cssSelector.trim();
    if (cssSelector) {
      action.selectors.css = cssSelector;
    } else {
      delete action.selectors.css;
    }
  }
  if (update.selectorNote !== undefined) {
    action.selectorNote = update.selectorNote.trim() || undefined;
  }
  if (update.url !== undefined && action.type === "navigate") {
    const url = normalizeNavigationUrl(update.url);
    action.url = url;
    action.pageUrl = url;
  }
  if (update.assertionType !== undefined && action.type === "assert") {
    action.assertionType = update.assertionType;
  }
  if (update.expected !== undefined && action.type === "assert") {
    action.expected = update.expected.trim();
  }
  if (update.timeout !== undefined && action.type === "assert") {
    action.timeout = clamp(Math.round(update.timeout), 500, 60_000);
  }
  if (update.onFailure !== undefined && action.type === "assert") {
    action.onFailure = update.onFailure;
  }
  if (update.retryCount !== undefined) {
    action.retryCount = clamp(Math.round(update.retryCount), 0, 10);
  }
  if (update.retryDelayMs !== undefined) {
    action.retryDelayMs = clamp(Math.round(update.retryDelayMs), 0, 60_000);
  }
  if (update.continueOnFailure !== undefined) {
    action.continueOnFailure = update.continueOnFailure;
  }
  if (update.screenshotOnFailure !== undefined) {
    action.screenshotOnFailure = update.screenshotOnFailure;
  }
  if (update.condition !== undefined) {
    action.condition = update.condition.type === "none" ? undefined : update.condition;
  }
  if (update.screenshotLabel !== undefined && action.type === "screenshot") {
    action.screenshotLabel = update.screenshotLabel.trim() || "evidence";
  }
  if (update.waitMs !== undefined && action.type === "wait") {
    action.waitMs = clamp(Math.round(update.waitMs), 250, 60_000);
  }
  if (update.networkWaitUrl !== undefined) {
    action.networkWaitUrl = update.networkWaitUrl.trim() || undefined;
  }
  if (update.waitForUrl !== undefined) {
    action.waitForUrl = update.waitForUrl.trim() || undefined;
  }
  if (update.key !== undefined && action.type === "press") {
    action.key = update.key;
  }
  if (update.dialogAction !== undefined && action.type === "dialog") {
    action.dialogAction = update.dialogAction;
  }
  if (update.dialogPromptText !== undefined && action.type === "dialog") {
    action.dialogPromptText = update.dialogPromptText.trim() || undefined;
  }
  if (update.elementScreenshot !== undefined && action.type === "screenshot") {
    action.elementScreenshot = update.elementScreenshot;
  }

  return action;
}

export function updateStep(actions: RecordedAction[], actionId: string, update: StepUpdate): RecordedAction[] {
  return actions.map((action) => (action.id === actionId ? applyStepUpdate(action, update) : action));
}

/**
 * Strip type-specific fields that no longer apply to an action's current type and
 * normalize navigation URLs. Use when an editor changes a step's type or before
 * persisting, so an action never carries contradictory fields (e.g. a step changed
 * from "navigate" to "click" keeping a stale `url`, or a relative navigate URL that
 * would break the compiler).
 */
export function sanitizeAction(action: RecordedAction): RecordedAction {
  const next: RecordedAction = { ...action, selectors: { ...action.selectors } };

  if (next.type === "navigate") {
    if (next.url) next.url = normalizeNavigationUrl(next.url);
  } else {
    delete next.url;
    delete next.waitForUrl;
  }
  if (next.type !== "fill" && next.type !== "select") delete next.value;
  if (next.type !== "assert") {
    delete next.assertionType;
    delete next.expected;
  }
  if (next.type !== "wait") delete next.waitMs;
  if (next.type !== "press") delete next.key;
  if (next.type !== "dialog") {
    delete next.dialogAction;
    delete next.dialogPromptText;
  }
  if (next.type !== "screenshot") {
    delete next.screenshotLabel;
    delete next.elementScreenshot;
  }
  if (next.type !== "click") delete next.networkWaitUrl;

  return next;
}

/** Toggle a parameter hint's confirmed flag on a single action. */
export function setParameterConfirmed(
  actions: RecordedAction[],
  actionId: string,
  paramIndex: number,
  confirmed: boolean
): RecordedAction[] {
  return actions.map((action) => {
    if (action.id !== actionId || !action.parameterHints?.[paramIndex]) return action;
    const parameterHints = action.parameterHints.map((hint, index) =>
      index === paramIndex ? { ...hint, confirmed } : hint
    );
    return { ...action, parameterHints };
  });
}

// ─── Workflow builder ───────────────────────────────────────────────────────────

export interface BuildWorkflowInput {
  actions: RecordedAction[];
  recordingStartUrl: string;
  recordingStartTime: number;
  impersonationDetected: boolean;
  nowMs?: number;
}

export function buildWorkflow(input: BuildWorkflowInput): RecordedWorkflow {
  const { actions, recordingStartUrl, recordingStartTime, impersonationDetected } = input;
  const nowMs = input.nowMs ?? Date.now();

  const parameters = extractParameters(actions);
  const assertions = generateAssertions(actions);
  const startUrl = extractRelativeStartUrl(recordingStartUrl);

  const workflowActions = actions.map((action) => ({
    ...action,
    value: replaceWithPlaceholders(action)
  }));

  return {
    version: 1,
    meta: {
      name: "",
      description: generateDescription(actions),
      recordedAt: new Date(nowMs).toISOString(),
      recordedOnUrl: recordingStartUrl,
      durationMs: nowMs - recordingStartTime,
      category: inferCategory(actions)
    },
    parameters,
    actions: workflowActions,
    assertions,
    config: {
      startUrl,
      requiresImpersonation: impersonationDetected || true,
      defaultTimeout: 10_000,
      retryableErrors: ["timeout", "temporarily unavailable", "net::", "target closed"]
    },
    quality: calculateQualityReport(workflowActions, assertions)
  };
}

export function extractRelativeStartUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return url.pathname + url.hash;
  } catch {
    return "/";
  }
}

// ─── Internals ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatAssertionType(type: NonNullable<RecordedAction["assertionType"]>): string {
  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}
