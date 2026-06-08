import type { RecordedAction, WorkflowAssertion } from "../types.js";

export type PreflightMode = "selectorOnly" | "readOnlyInspect" | "dryRunUntilSubmit";
export type PreflightOutcome = "willRun" | "willSkip" | "willFail" | "needsReview";

export interface PreflightSelectorState {
  matchedCount: number;
  visibleCount: number;
  chosenPreview?: string;
}

export interface PreflightAccountInput {
  accountId: string;
  ownerEmail?: string;
  accountName?: string;
  visibleText?: string;
  selectorStates?: Record<string, PreflightSelectorState>;
  reviewReasons?: string[];
}

export interface PreflightIssue {
  actionId?: string;
  severity: "info" | "warning" | "blocking";
  category: "selector" | "idempotency" | "parameters" | "unsupported" | "inventory" | "mutation";
  message: string;
}

export interface PreflightAccountResult {
  accountId: string;
  ownerEmail?: string;
  accountName?: string;
  predictedOutcome: PreflightOutcome;
  issues: PreflightIssue[];
  matchedTargetText: string[];
}

export interface PreflightPlanInput {
  workflowId: string;
  workflowName: string;
  actions: RecordedAction[];
  assertions: WorkflowAssertion[];
  accounts: PreflightAccountInput[];
  mode?: PreflightMode;
}

export interface PreflightPlanResult {
  workflowId: string;
  workflowName: string;
  mode: PreflightMode;
  accounts: PreflightAccountResult[];
  summary: Record<PreflightOutcome, number>;
}
