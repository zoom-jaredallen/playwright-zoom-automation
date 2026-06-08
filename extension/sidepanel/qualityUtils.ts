import { isCommitClickLabel, scoreSelector } from "@zoom-automation/workflow-core";
import {
  isSelectorBasedStep,
  isSubmitLikeClickStep
} from "../shared/stepPresentation.js";
import type { ParameterHint, RecordedAction, WorkflowQualityReport } from "../shared/types.js";

export interface SelectorConfidence {
  level: "strong" | "medium" | "weak" | "manual";
  reason: string;
}

export function collectAllParameters(inputActions: RecordedAction[]): Array<{ actionId: string; paramIndex: number; hint: ParameterHint }> {
  const results: Array<{ actionId: string; paramIndex: number; hint: ParameterHint }> = [];
  const seen = new Set<string>();

  for (const action of inputActions) {
    if (!action.parameterHints) continue;
    for (let index = 0; index < action.parameterHints.length; index++) {
      const hint = action.parameterHints[index];
      if (seen.has(hint.suggestedName)) continue;
      seen.add(hint.suggestedName);
      results.push({ actionId: action.id, paramIndex: index, hint });
    }
  }

  return results;
}

export function selectorConfidence(action: RecordedAction): SelectorConfidence {
  if (!isSelectorBased(action)) {
    return { level: "manual", reason: "Manual or page-level step" };
  }
  if (action.selectors.role?.name || action.selectors.testId) {
    return { level: "strong", reason: "Uses accessible role/name or test id" };
  }
  if (action.selectors.label || action.selectors.text) {
    return { level: "medium", reason: "Uses visible label or text" };
  }
  if (action.selectors.css) {
    return { level: "weak", reason: "Uses CSS fallback only" };
  }
  return { level: "weak", reason: "No usable selector captured" };
}

export function hasUsableSelector(action: RecordedAction): boolean {
  const selectors = action.selectors;
  return Boolean(selectors.role || selectors.label || selectors.text || selectors.testId || selectors.css);
}

export function isSelectorBased(action: RecordedAction): boolean {
  return isSelectorBasedStep(action);
}

export function isSubmitLikeClick(action: RecordedAction): boolean {
  return isSubmitLikeClickStep(action);
}

export function formatSelectors(action: RecordedAction): string {
  const selectors = action.selectors;
  const parts = [
    selectors.role ? `role=${selectors.role.role}${selectors.role.name ? ` name="${selectors.role.name}"` : ""}` : undefined,
    selectors.label ? `label="${selectors.label}"` : undefined,
    selectors.text ? `text="${selectors.text}"` : undefined,
    selectors.testId ? `testId="${selectors.testId}"` : undefined,
    selectors.css ? `css="${selectors.css}"` : undefined,
    selectors.anchor?.text ? `anchor=${selectors.anchor.scopeRole ?? "row"} containing "${selectors.anchor.text}"` : undefined,
    action.selectorNote ? `note="${action.selectorNote}"` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "No selector required";
}

export function calculateQualityReport(inputActions: RecordedAction[]): WorkflowQualityReport {
  const actionable = inputActions.filter((action) => !["navigate", "wait", "screenshot", "dismiss"].includes(action.type));
  const stableSelectors = actionable.filter((action) => action.selectors.role?.name || action.selectors.label || action.selectors.testId).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = inputActions.filter((action) => action.type === "click" && isCommitClickLabel(action.selectors.role?.name ?? action.selectors.text ?? ""));
  const assertionActions = inputActions.filter((action) => action.type === "assert");
  const assertionCoverage = submitActions.length === 0 ? 100 : Math.round((Math.min(assertionActions.length, submitActions.length) / submitActions.length) * 100);
  const evidenceCount = inputActions.filter((action) => action.type === "screenshot" || action.screenshotOnFailure || action.onFailure === "screenshot").length;
  const evidenceCoverage = inputActions.length === 0 ? 100 : Math.round((evidenceCount / inputActions.length) * 100);
  const riskySteps = inputActions.filter((action) => action.type === "click" && !action.selectors.role?.name && !action.selectors.testId).length;
  const hardcodedValues = inputActions.filter((action) => {
    const value = action.value ?? action.expected ?? "";
    return value.length > 0 && !value.includes("{{") && action.type !== "assert";
  }).length;
  const unsupportedBrowserPreflightSteps = inputActions.filter((action) => action.type === "upload").length;
  const penalties = riskySteps * 7 + hardcodedValues * 3 + unsupportedBrowserPreflightSteps * 8;
  const score = Math.max(0, Math.min(100, Math.round((selectorStability * 0.35) + (assertionCoverage * 0.3) + (evidenceCoverage * 0.2) + 15 - penalties)));
  const warnings = [
    selectorStability < 70 ? "Several steps rely on weak selectors." : undefined,
    assertionCoverage < 80 ? "Add validations after important submit/save actions." : undefined,
    evidenceCoverage < 25 ? "Add screenshots for evidence and failure diagnosis." : undefined,
    unsupportedBrowserPreflightSteps > 0 ? "Upload steps cannot be tested by the extension preflight runner." : undefined,
    hardcodedValues > 0 ? "Review hardcoded values and parameterize tenant-specific inputs." : undefined
  ].filter(Boolean) as string[];

  return { score, selectorStability, assertionCoverage, evidenceCoverage, riskySteps, hardcodedValues, unsupportedBrowserPreflightSteps, warnings };
}
