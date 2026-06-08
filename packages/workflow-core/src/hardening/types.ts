import type { RecordedAction } from "../types.js";

export type WorkflowIntent = "create" | "update" | "delete" | "assign" | "remove" | "toggle" | "verify" | "unknown";

export type IntentConfidence = "high" | "medium" | "low";

export type StepRisk = "read" | "edit" | "mutation" | "destructive";

export interface StepRiskAnalysis {
  actionId: string;
  risk: StepRisk;
  reasons: string[];
}

export interface WorkflowIntentAnalysis {
  intent: WorkflowIntent;
  confidence: IntentConfidence;
  reasons: string[];
  entryStepIds: string[];
  mutationStepIds: string[];
  destructiveStepIds: string[];
  requiresIdempotency: boolean;
  requiresOutcomeAssertion: boolean;
  stepRisks: StepRiskAnalysis[];
}

export type FingerprintSource = "fill" | "select" | "toggle" | "row" | "url" | "adapter";

export interface EntityFingerprintField {
  label: string;
  value: string;
  source: FingerprintSource;
  actionId?: string;
  confidence: IntentConfidence;
}

export interface EntityModel {
  entityKind: string;
  operation: Exclude<WorkflowIntent, "toggle" | "verify" | "unknown"> | "update" | "verify" | "unknown";
  confidence: IntentConfidence;
  fingerprintFields: EntityFingerprintField[];
  desiredState: {
    exists?: boolean;
    values: Record<string, string>;
  };
  sourceActionIds: string[];
  warnings: string[];
}

export interface WorkflowHardeningInput {
  actions: RecordedAction[];
  assertions?: Array<{ afterAction: string }>;
}
