import type { RankedSelectorCandidate, SelectorCandidate } from "../types.js";
import { scoreSelectorCandidate } from "./scoring.js";

export function rankSelectorCandidates(candidates: SelectorCandidate[]): RankedSelectorCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreSelectorCandidate(candidate) }))
    .sort((a, b) => {
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      return a.index - b.index;
    })
    .map(({ candidate, score }, index) => ({
      ...candidate,
      rank: index + 1,
      score
    }));
}

export function recommendedSelectorCandidate(candidates: SelectorCandidate[]): RankedSelectorCandidate | undefined {
  return rankSelectorCandidates(candidates)[0];
}
