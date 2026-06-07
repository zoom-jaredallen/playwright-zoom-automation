import type { SelectorCandidate, SelectorRepairSuggestion, SelectorStrategy } from "../types.js";
import { rankSelectorCandidates } from "./ranking.js";

export interface SelectorRepairPlanInput {
  currentSelector?: SelectorStrategy;
  candidates: SelectorCandidate[];
}

export interface SelectorRepairPlan {
  suggestions: SelectorRepairSuggestion[];
  best?: SelectorRepairSuggestion;
}

export function createSelectorRepairPlan(input: SelectorRepairPlanInput): SelectorRepairPlan {
  const ranked = rankSelectorCandidates(input.candidates);
  const suggestions = ranked.map((candidate): SelectorRepairSuggestion => {
    const selector = applySharedContext(candidate.selector, input.currentSelector);
    return {
      candidateId: candidate.id,
      selector,
      source: candidate.source ?? "generated",
      score: candidate.score,
      matchedCount: candidate.diagnostics?.matchedCount ?? 0,
      visibleCount: candidate.diagnostics?.visibleCount ?? 0,
      risk: riskForCandidate(candidate.kind, candidate.score.level)
    };
  });
  return { suggestions, best: suggestions[0] };
}

function applySharedContext(candidate: SelectorStrategy, currentSelector: SelectorStrategy | undefined): SelectorStrategy {
  return {
    ...candidate,
    ...(candidate.anchor || !currentSelector?.anchor ? {} : { anchor: currentSelector.anchor }),
    ...(candidate.nth !== undefined || currentSelector?.nth === undefined ? {} : { nth: currentSelector.nth })
  };
}

function riskForCandidate(kind: SelectorCandidate["kind"], level: SelectorRepairSuggestion["score"]["level"]): SelectorRepairSuggestion["risk"] {
  if (level === "high" && kind !== "css" && kind !== "xpath") return "low";
  if (level === "low" || kind === "css" || kind === "xpath") return "high";
  return "medium";
}
