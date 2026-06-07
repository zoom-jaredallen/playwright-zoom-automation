import type { Locator } from "playwright";
import type { RankedSelectorCandidate } from "@zoom-automation/workflow-core";

export type SelectorRuntimeConfidence = "high" | "medium" | "low";

export interface SelectorResolutionPlanEntry extends RankedSelectorCandidate {
  candidate: RankedSelectorCandidate;
  strategyName: string;
}

export interface SelectorResolutionDiagnostics {
  requestedStrategies: string[];
  selectedStrategy?: string;
  selectedRank?: number;
  matchedCount: number;
  visibleCount: number;
  confidence: SelectorRuntimeConfidence;
  fallbackUsed: boolean;
  elapsedMs: number;
  warnings: string[];
}

export interface SelectorResolutionDiagnosticsInput {
  requestedStrategies: string[];
  selectedStrategy?: string;
  selectedRank?: number;
  matchedCount: number;
  visibleCount: number;
  elapsedMs: number;
  warnings?: string[];
}

export interface SelectorResolutionResult {
  locator: Locator;
  diagnostics: SelectorResolutionDiagnostics;
}
