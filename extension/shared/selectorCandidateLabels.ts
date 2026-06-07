import type { SelectorTestResult } from "./types.js";

type FallbackCandidate = SelectorTestResult["fallbackCandidates"][number];

export function formatSelectorCandidateLabel(candidate: FallbackCandidate): string {
  const parts = [
    candidate.label,
    candidate.kind,
    candidate.score !== undefined ? String(candidate.score) : undefined,
    `${candidate.visibleCount}/${candidate.matchedCount} visible`
  ].filter(Boolean);
  return parts.join(" · ");
}

export function selectorCandidateScoreClass(level: FallbackCandidate["scoreLevel"] | undefined): string {
  return `selector-score ${level ?? "unknown"}`;
}
