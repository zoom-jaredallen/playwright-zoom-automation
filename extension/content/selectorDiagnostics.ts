import { createSelectorRepairPlan, type RankedSelectorCandidate } from "@zoom-automation/workflow-core";
import { buildSelectorCandidatesForElement, testSelectorCandidatesInDocument } from "../shared/selectorCandidates.js";
import type { RecordedAction, SelectorTestResult } from "../shared/types.js";
import { elementPreview, highlightElement } from "./domHelpers.js";
import {
  buildCandidatesFromLegacyAction,
  candidateLabel,
  candidateResult,
  findReplayElementSync,
  stripRuntimeScores
} from "./replayRunner.js";

export function rankSelectorCandidatesForTarget(element: Element): RankedSelectorCandidate[] {
  return testSelectorCandidatesInDocument(buildSelectorCandidatesForElement(element), document, element);
}

export async function testSelector(action: RecordedAction): Promise<SelectorTestResult> {
  try {
    const candidates = action.selectorCandidates?.length
      ? action.selectorCandidates
      : buildCandidatesFromLegacyAction(action);
    const ranked = testSelectorCandidatesInDocument(candidates, document);
    const persistedCandidates = stripRuntimeScores(ranked);
    const repairPlan = createSelectorRepairPlan({
      currentSelector: action.selectors,
      candidates: persistedCandidates
    });
    const best = ranked[0];

    const chosen = findReplayElementSync(action);
    if (chosen) {
      highlightElement(chosen);
    }

    return {
      actionId: action.id,
      matchedCount: ranked[0]?.diagnostics?.matchedCount ?? 0,
      visibleCount: ranked[0]?.diagnostics?.visibleCount ?? 0,
      chosenPreview: chosen ? elementPreview(chosen) : undefined,
      chosenSelector: ranked[0] ? candidateLabel(ranked[0]) : undefined,
      fallbackCandidates: ranked.map(candidateResult),
      selectorDiagnostics: best ? selectorDiagnosticsFromRanked(best, chosen ?? null) : undefined,
      repairSuggestions: repairPlan.suggestions
    };
  } catch (error) {
    return {
      actionId: action.id,
      matchedCount: 0,
      visibleCount: 0,
      fallbackCandidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function selectorDiagnosticsForTarget(element: Element, candidate: RankedSelectorCandidate | undefined): RecordedAction["selectorDiagnostics"] {
  const fallbackScore = { score: 0, level: "low" as const, reasons: ["No selector candidates captured"] };
  return {
    matchedCount: candidate?.diagnostics?.matchedCount ?? 0,
    visibleCount: candidate?.diagnostics?.visibleCount ?? 0,
    chosenCandidateId: candidate?.id,
    confidence: candidate?.score ?? fallbackScore,
    targetPreview: elementPreview(element),
    anchor: {
      text: candidate?.selector.anchor?.text,
      scopeRole: candidate?.selector.anchor?.scopeRole,
      scopeSelector: candidate?.selector.anchor?.scopeSelector,
      kind: candidate?.selector.anchor?.kind,
      relationship: candidate?.selector.anchor?.relationship,
      resolved: Boolean(candidate?.selector.anchor?.text && candidate.diagnostics?.anchorReducedMatches)
    },
    context: candidate?.diagnostics?.context
  };
}

function selectorDiagnosticsFromRanked(candidate: RankedSelectorCandidate, target: Element | null): RecordedAction["selectorDiagnostics"] {
  return {
    matchedCount: candidate.diagnostics?.matchedCount ?? 0,
    visibleCount: candidate.diagnostics?.visibleCount ?? 0,
    chosenCandidateId: candidate.id,
    confidence: candidate.score,
    targetPreview: target ? elementPreview(target) : candidate.diagnostics?.chosenPreview,
    anchor: {
      text: candidate.selector.anchor?.text,
      scopeRole: candidate.selector.anchor?.scopeRole,
      scopeSelector: candidate.selector.anchor?.scopeSelector,
      kind: candidate.selector.anchor?.kind,
      relationship: candidate.selector.anchor?.relationship,
      resolved: Boolean(candidate.selector.anchor?.text && candidate.diagnostics?.anchorReducedMatches)
    },
    context: candidate.diagnostics?.context
  };
}
