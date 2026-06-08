import {
  buildPreflightPlan,
  createZoomAdminAdapter,
  hardenRecordedWorkflow,
  type PreflightAccountInput,
  type PreflightAccountResult,
  type PreflightOutcome,
  type PreflightPlanResult,
  type PreflightSelectorState,
  type RecordedWorkflow
} from "@zoom-automation/workflow-core";
import type { SubAccount } from "../../automation/types.js";

export interface BulkPreflightEvidence {
  visibleText?: string;
  selectorStates?: Record<string, PreflightSelectorState>;
  reviewReasons?: string[];
}

export interface BulkPreflightWorkflowInput {
  id: string;
  workflow: RecordedWorkflow;
}

export interface BulkPreflightInput {
  workflows: BulkPreflightWorkflowInput[];
  accounts: SubAccount[];
  accountEvidence?: Record<string, BulkPreflightEvidence>;
}

export interface BulkPreflightAccountResult {
  accountId: string;
  ownerEmail?: string;
  accountName?: string;
  predictedOutcome: PreflightOutcome;
  workflowOutcomes: Array<{
    workflowId: string;
    workflowName: string;
    predictedOutcome: PreflightOutcome;
    issues: PreflightAccountResult["issues"];
    matchedTargetText: string[];
  }>;
}

export interface BulkPreflightResult {
  workflows: PreflightPlanResult[];
  accounts: BulkPreflightAccountResult[];
  summary: Record<PreflightOutcome, number>;
}

const OUTCOME_PRIORITY: Record<PreflightOutcome, number> = {
  willFail: 4,
  needsReview: 3,
  willRun: 2,
  willSkip: 1
};

export function createBulkPreflightPlan(input: BulkPreflightInput): BulkPreflightResult {
  const accountInputs = input.accounts.map((account): PreflightAccountInput => {
    const evidence = input.accountEvidence?.[account.id];
    const reviewReasons = [...(evidence?.reviewReasons ?? [])];
    if (!evidence) {
      reviewReasons.push("No live preflight evidence was provided for this account; prediction is schema-only.");
    }
    return {
      accountId: account.id,
      ownerEmail: account.ownerEmail,
      accountName: account.name,
      visibleText: evidence?.visibleText,
      selectorStates: evidence?.selectorStates,
      reviewReasons
    };
  });

  const workflows = input.workflows.map(({ id, workflow }) => {
    const hardened = hardenRecordedWorkflow({
      actions: workflow.actions,
      assertions: workflow.assertions,
      adapter: createZoomAdminAdapter()
    });
    const actions = preserveExistingEntityGuards(workflow.actions, hardened.actions);
    return buildPreflightPlan({
      workflowId: id,
      workflowName: workflow.meta.name,
      actions,
      assertions: hardened.assertions,
      accounts: accountInputs
    });
  });

  const accounts = input.accounts.map((account) => {
    const workflowOutcomes = workflows.map((plan) => {
      const result = plan.accounts.find((item) => item.accountId === account.id);
      return {
        workflowId: plan.workflowId,
        workflowName: plan.workflowName,
        predictedOutcome: result?.predictedOutcome ?? "needsReview",
        issues: result?.issues ?? [{ severity: "warning", category: "unsupported", message: "No preflight result was produced for this account." }],
        matchedTargetText: result?.matchedTargetText ?? []
      };
    });

    return {
      accountId: account.id,
      ownerEmail: account.ownerEmail,
      accountName: account.name,
      predictedOutcome: strongestOutcome(workflowOutcomes.map((outcome) => outcome.predictedOutcome)),
      workflowOutcomes
    };
  });

  return {
    workflows,
    accounts,
    summary: summarize(accounts)
  };
}

function preserveExistingEntityGuards(originalActions: RecordedWorkflow["actions"], hardenedActions: RecordedWorkflow["actions"]): RecordedWorkflow["actions"] {
  const originalById = new Map(originalActions.map((action) => [action.id, action]));
  return hardenedActions.map((action) => {
    if (action.condition?.type === "entityStateGuard") return action;
    const originalCondition = originalById.get(action.id)?.condition;
    return originalCondition?.type === "entityStateGuard" ? { ...action, condition: originalCondition } : action;
  });
}

function strongestOutcome(outcomes: PreflightOutcome[]): PreflightOutcome {
  return outcomes.reduce<PreflightOutcome>((strongest, outcome) => (
    OUTCOME_PRIORITY[outcome] > OUTCOME_PRIORITY[strongest] ? outcome : strongest
  ), "willSkip");
}

function summarize(accounts: Array<{ predictedOutcome: PreflightOutcome }>): Record<PreflightOutcome, number> {
  return accounts.reduce<Record<PreflightOutcome, number>>((summary, account) => {
    summary[account.predictedOutcome] += 1;
    return summary;
  }, { willRun: 0, willSkip: 0, willFail: 0, needsReview: 0 });
}
