import type { RecordedAction } from "../types.js";
import type {
  PreflightAccountInput,
  PreflightAccountResult,
  PreflightIssue,
  PreflightOutcome,
  PreflightPlanInput,
  PreflightPlanResult
} from "./types.js";

export function buildPreflightPlan(input: PreflightPlanInput): PreflightPlanResult {
  const accounts = input.accounts.map((account) => evaluateAccount(account, input.actions));
  return {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    mode: input.mode ?? "readOnlyInspect",
    accounts,
    summary: summarize(accounts)
  };
}

function evaluateAccount(account: PreflightAccountInput, actions: RecordedAction[]): PreflightAccountResult {
  const issues: PreflightIssue[] = [];
  const matchedTargetText = matchedIdempotencyText(account.visibleText, actions);

  if (matchedTargetText.length > 0) {
    issues.push({
      severity: "info",
      category: "idempotency",
      message: `Target state already appears to exist: ${matchedTargetText.join(", ")}`
    });
    return accountResult(account, "willSkip", issues, matchedTargetText);
  }

  for (const reason of account.reviewReasons ?? []) {
    issues.push({ severity: "warning", category: "unsupported", message: reason });
  }

  for (const action of actions) {
    if (action.type === "upload") {
      issues.push({
        actionId: action.id,
        severity: "warning",
        category: "unsupported",
        message: "Upload steps require manual evidence review during preflight."
      });
    }

    if (isMutatingAction(action)) {
      issues.push({
        actionId: action.id,
        severity: "info",
        category: "mutation",
        message: "Preflight stops before this mutation boundary."
      });
    }

    if (["click", "fill", "select"].includes(action.type)) {
      const selectorState = account.selectorStates?.[action.id];
      if (selectorState && selectorState.visibleCount === 0) {
        issues.push({
          actionId: action.id,
          severity: "blocking",
          category: "selector",
          message: `No visible match for ${action.description ?? action.id}`
        });
      }
    }

    if (action.type === "selectRows" && action.rowSelection) {
      const available = countPatternMatches(account.visibleText, action.rowSelection.valuePattern);
      const minimum = action.rowSelection.minimumCount ?? action.rowSelection.count;
      if (available < minimum) {
        issues.push({
          actionId: action.id,
          severity: "blocking",
          category: "inventory",
          message: `Only ${available} matching row value(s) found; ${minimum} required.`
        });
      }
    }
  }

  if (issues.some((issue) => issue.severity === "blocking")) {
    return accountResult(account, "willFail", issues, matchedTargetText);
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return accountResult(account, "needsReview", issues, matchedTargetText);
  }
  return accountResult(account, "willRun", issues, matchedTargetText);
}

function matchedIdempotencyText(visibleText: string, actions: RecordedAction[]): string[] {
  const normalizedPageText = normalizeText(visibleText);
  const matches = new Set<string>();
  for (const action of actions) {
    const guard = action.condition;
    if (guard?.type !== "entityStateGuard" || guard.whenMatched !== "skipAccount") continue;
    for (const value of guard.match?.allText ?? []) {
      if (value && normalizedPageText.includes(normalizeText(value))) matches.add(value);
    }
    for (const value of guard.match?.anyText ?? []) {
      if (value && normalizedPageText.includes(normalizeText(value))) matches.add(value);
    }
  }
  return [...matches];
}

function countPatternMatches(text: string, pattern?: string): number {
  if (!pattern) return 0;
  try {
    const matches = text.match(new RegExp(pattern, "gi"));
    return new Set((matches ?? []).map((match) => normalizeText(match))).size;
  } catch {
    return 0;
  }
}

function isMutatingAction(action: RecordedAction): boolean {
  if (action.sideEffectRisk === "mutation" || action.sideEffectRisk === "destructive") return true;
  if (action.intentMetadata?.mutationBoundary) return true;
  if (action.networkWaitUrl && /\b(add|create|save|update|delete|assign|reserve|submit)\b/i.test(action.description ?? action.selectors.role?.name ?? "")) return true;
  return false;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function accountResult(
  account: PreflightAccountInput,
  predictedOutcome: PreflightOutcome,
  issues: PreflightIssue[],
  matchedTargetText: string[]
): PreflightAccountResult {
  return {
    accountId: account.accountId,
    ownerEmail: account.ownerEmail,
    accountName: account.accountName,
    predictedOutcome,
    issues,
    matchedTargetText
  };
}

function summarize(accounts: PreflightAccountResult[]): Record<PreflightOutcome, number> {
  return accounts.reduce<Record<PreflightOutcome, number>>((summary, account) => {
    summary[account.predictedOutcome] += 1;
    return summary;
  }, { willRun: 0, willSkip: 0, willFail: 0, needsReview: 0 });
}
