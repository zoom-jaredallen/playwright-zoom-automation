import type { SelectorResolutionDiagnostics, SelectorResolutionDiagnosticsInput } from "./types.js";

export function createSelectorResolutionDiagnostics(input: SelectorResolutionDiagnosticsInput): SelectorResolutionDiagnostics {
  const fallbackUsed = input.selectedRank !== undefined && input.selectedRank > 1;
  return {
    requestedStrategies: [...input.requestedStrategies],
    selectedStrategy: input.selectedStrategy,
    selectedRank: input.selectedRank,
    matchedCount: input.matchedCount,
    visibleCount: input.visibleCount,
    confidence: confidenceFor(input.visibleCount, fallbackUsed, input.warnings ?? []),
    fallbackUsed,
    elapsedMs: input.elapsedMs,
    warnings: [...(input.warnings ?? [])]
  };
}

function confidenceFor(visibleCount: number, fallbackUsed: boolean, warnings: string[]): "high" | "medium" | "low" {
  if (visibleCount === 1 && !fallbackUsed && warnings.length === 0) return "high";
  if (visibleCount >= 1 && warnings.every((warning) => !/no visible|missing/i.test(warning))) return "medium";
  return "low";
}
