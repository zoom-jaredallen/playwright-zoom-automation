import type { RecordedAction } from "../types.js";
import { actionLabel, actionSearchText, flattenActionTree } from "./actionText.js";
import type { StepRisk, StepRiskAnalysis, WorkflowIntent, WorkflowIntentAnalysis } from "./types.js";

const CREATE_ENTRY_RE = /\b(add|create|new|invite)\b/i;
const COMMIT_RE = /\b(save|submit|confirm|apply|create|update|finish|done|add|assign|remove|delete)\b/i;
const DELETE_RE = /\b(delete|remove|deprovision|disable|deactivate)\b/i;
const ASSIGN_RE = /\b(assign|add package|add role|grant)\b/i;
const VERIFY_RE = /\b(assert|verify|check|validate)\b/i;
const SETTINGS_RE = /\b(setting|policy|toggle|enable|disable|lock|unlock)\b/i;
const MUTATION_URL_RE = /\/(api|webapi|graphql|v2)\/|\/(add|create|save|update|delete|remove|assign|settings?)/i;

export function analyzeWorkflowIntent(actionTree: RecordedAction[]): WorkflowIntentAnalysis {
  const actions = flattenActionTree(actionTree);
  const text = actions.map(actionSearchText).join(" ");
  const intent = inferIntent(actions, text);
  const stepRisks = actions.map((action, index) => classifyStepRisk(action, intent, index, actions.length));
  const mutationStepIds = stepRisks
    .filter((risk) => risk.risk === "mutation" || risk.risk === "destructive")
    .map((risk) => risk.actionId);
  const destructiveStepIds = stepRisks
    .filter((risk) => risk.risk === "destructive")
    .map((risk) => risk.actionId);
  const entryStepIds = inferEntryStepIds(actions, intent);
  const confidence = scoreIntentConfidence(intent, actions, mutationStepIds, entryStepIds);

  return {
    intent,
    confidence,
    reasons: buildIntentReasons(intent, confidence, entryStepIds, mutationStepIds, destructiveStepIds),
    entryStepIds,
    mutationStepIds,
    destructiveStepIds,
    requiresIdempotency: ["create", "update", "assign", "remove", "delete", "toggle"].includes(intent),
    requiresOutcomeAssertion: mutationStepIds.length > 0,
    stepRisks
  };
}

function inferIntent(actions: RecordedAction[], text: string): WorkflowIntent {
  if (DELETE_RE.test(text)) return text.includes("assign") ? "remove" : "delete";
  if (ASSIGN_RE.test(text)) return "assign";
  if (hasCreateEntry(actions) && hasCommit(actions)) return "create";
  if (actions.some((action) => action.ariaState) || SETTINGS_RE.test(text)) return "update";
  if (hasCommit(actions)) return "update";
  if (VERIFY_RE.test(text) || actions.some((action) => action.type === "assert")) return "verify";
  return "unknown";
}

function hasCreateEntry(actions: RecordedAction[]): boolean {
  return actions.some((action, index) => action.type === "click" && index < actions.length - 1 && CREATE_ENTRY_RE.test(actionLabel(action)));
}

function hasCommit(actions: RecordedAction[]): boolean {
  return actions.some((action) => action.type === "click" && COMMIT_RE.test(actionLabel(action)));
}

function classifyStepRisk(action: RecordedAction, intent: WorkflowIntent, index: number, actionCount: number): StepRiskAnalysis {
  const label = actionLabel(action);
  const searchText = actionSearchText(action);
  const reasons: string[] = [];
  let risk: StepRisk = "read";

  if (["fill", "select", "selectRows", "press", "upload"].includes(action.type)) {
    risk = "edit";
    reasons.push(`${action.type} changes local form state`);
  }

  const isCreateEntryOpener = action.type === "click" && index < actionCount - 1 && CREATE_ENTRY_RE.test(label) && !action.networkWaitUrl;

  if (action.type === "click" && COMMIT_RE.test(label) && !isCreateEntryOpener) {
    risk = "mutation";
    reasons.push(`button label "${label}" looks like a commit action`);
  }

  if (action.networkWaitUrl && MUTATION_URL_RE.test(action.networkWaitUrl)) {
    risk = "mutation";
    reasons.push(`waits for mutation-like network URL ${action.networkWaitUrl}`);
  }

  if (action.type === "click" && (DELETE_RE.test(label) || DELETE_RE.test(searchText) || intent === "delete" && /\bconfirm\b/i.test(label))) {
    risk = "destructive";
    reasons.push(`step is part of a ${intent} flow`);
  }

  return { actionId: action.id, risk, reasons };
}

function inferEntryStepIds(actions: RecordedAction[], intent: WorkflowIntent): string[] {
  if (intent !== "create" && intent !== "assign") return [];
  return actions
    .filter((action, index) => action.type === "click" && index < actions.length - 1 && CREATE_ENTRY_RE.test(actionLabel(action)))
    .map((action) => action.id);
}

function scoreIntentConfidence(intent: WorkflowIntent, actions: RecordedAction[], mutationStepIds: string[], entryStepIds: string[]): WorkflowIntentAnalysis["confidence"] {
  if (intent === "unknown") return "low";
  if (intent === "create" && entryStepIds.length > 0 && mutationStepIds.length > 0) return "high";
  if (intent === "delete" && mutationStepIds.length > 0) return "high";
  if (intent === "update" && (mutationStepIds.length > 0 || actions.some((action) => action.ariaState))) return "high";
  return mutationStepIds.length > 0 ? "medium" : "low";
}

function buildIntentReasons(
  intent: WorkflowIntent,
  confidence: WorkflowIntentAnalysis["confidence"],
  entryStepIds: string[],
  mutationStepIds: string[],
  destructiveStepIds: string[]
): string[] {
  const reasons = [`Detected ${intent} workflow with ${confidence} confidence.`];
  if (entryStepIds.length > 0) reasons.push(`Entry steps: ${entryStepIds.join(", ")}.`);
  if (mutationStepIds.length > 0) reasons.push(`Mutation steps: ${mutationStepIds.join(", ")}.`);
  if (destructiveStepIds.length > 0) reasons.push(`Destructive steps: ${destructiveStepIds.join(", ")}.`);
  return reasons;
}
