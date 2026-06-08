import type { RecordedAction } from "../types.js";
import { actionSearchText, flattenActionTree, normalizedFieldLabel } from "./actionText.js";
import type { EntityFingerprintField, EntityModel, WorkflowIntentAnalysis } from "./types.js";

const WEAK_VALUE_RE = /^(save|submit|confirm|add|create|update|delete|remove|enabled?|disabled?|checked|unchecked)$/i;

export function buildEntityModel(actionTree: RecordedAction[], analysis: WorkflowIntentAnalysis): EntityModel {
  const actions = flattenActionTree(actionTree);
  const fingerprintFields = extractFingerprintFields(actions);
  const values = Object.fromEntries(fingerprintFields.map((field) => [field.label, field.value]));
  const entityKind = inferEntityKind(actions);
  const operation = normalizeOperation(analysis.intent);
  const warnings = buildWarnings(fingerprintFields, analysis);

  return {
    entityKind,
    operation,
    confidence: confidenceFor(fingerprintFields.length, entityKind),
    fingerprintFields,
    desiredState: {
      exists: operation === "delete" || operation === "remove" ? false : true,
      values
    },
    sourceActionIds: fingerprintFields.map((field) => field.actionId).filter(Boolean) as string[],
    warnings
  };
}

function extractFingerprintFields(actions: RecordedAction[]): EntityFingerprintField[] {
  const fields: EntityFingerprintField[] = [];
  for (const action of actions) {
    if ((action.type === "fill" || action.type === "select") && action.value) {
      const label = normalizedFieldLabel(action);
      const value = action.value.trim();
      if (label && value && !isWeakValue(value)) {
        fields.push({
          label,
          value,
          source: action.type,
          actionId: action.id,
          confidence: confidenceForValue(label, value)
        });
      }
    }

    if (action.ariaState && isFingerprintState(action.ariaState)) {
      const label = normalizedFieldLabel(action);
      const value = stateValue(action.ariaState);
      if (label && value) {
        fields.push({
          label,
          value,
          source: "toggle",
          actionId: action.id,
          confidence: "high"
        });
      }
    }
  }
  return dedupeFields(fields);
}

function inferEntityKind(actions: RecordedAction[]): string {
  const text = actions.map(actionSearchText).join(" ");
  if (/get-number|add number|get number|phone number|\+\d[\d\s().-]{5,}/i.test(text)) return "phoneNumber";
  if (/business-address|business address/i.test(text)) return "businessAddress";
  if (/\bsetting|settings|policy|policies|lock|unlock\b/i.test(text)) return "accountSetting";
  if (/\bqueue|queues\b/i.test(text)) return "queue";
  if (/\buser|users|email address\b/i.test(text)) return "user";
  if (/\bbrand|campaign|10dlc\b/i.test(text)) return "campaign";
  if (/\brole|package|license\b/i.test(text)) return "assignment";
  return "unknown";
}

function normalizeOperation(intent: WorkflowIntentAnalysis["intent"]): EntityModel["operation"] {
  if (intent === "toggle") return "update";
  if (intent === "verify") return "verify";
  if (intent === "unknown") return "unknown";
  return intent;
}

function buildWarnings(fields: EntityFingerprintField[], analysis: WorkflowIntentAnalysis): string[] {
  const warnings: string[] = [];
  if (fields.length === 0 && analysis.requiresIdempotency) warnings.push("No stable entity fingerprint was inferred.");
  if (fields.length === 1 && analysis.requiresIdempotency) warnings.push("Only one fingerprint field was inferred; duplicate detection may be weak.");
  return warnings;
}

function confidenceFor(fieldCount: number, entityKind: string): EntityModel["confidence"] {
  if (fieldCount >= 2 && entityKind !== "unknown") return "high";
  if (fieldCount >= 1) return "medium";
  return "low";
}

function confidenceForValue(label: string, value: string): EntityFingerprintField["confidence"] {
  if (/email/i.test(label) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "high";
  if (/name|queue|extension|campaign|brand|address|city|postal|zip/i.test(label)) return "high";
  return "medium";
}

function isWeakValue(value: string): boolean {
  return WEAK_VALUE_RE.test(value.trim());
}

function stateValue(state: NonNullable<RecordedAction["ariaState"]>): string {
  if (state.checked !== undefined) return state.checked ? "checked" : "unchecked";
  if (state.selected !== undefined) return state.selected ? "selected" : "unselected";
  if (state.expanded !== undefined) return state.expanded ? "expanded" : "collapsed";
  return "";
}

function isFingerprintState(state: NonNullable<RecordedAction["ariaState"]>): boolean {
  return state.checked !== undefined || state.selected !== undefined;
}

function dedupeFields(fields: EntityFingerprintField[]): EntityFingerprintField[] {
  const seen = new Set<string>();
  const result: EntityFingerprintField[] = [];
  for (const field of fields) {
    const key = `${field.label.toLowerCase()}\u0000${field.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}
