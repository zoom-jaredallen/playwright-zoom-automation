import type { SelectorCandidate, SelectorStrategy } from "@zoom-automation/workflow-core";

export type SelectorPreference = "aria" | "css" | "xpath" | "text";

export function applySelectorCandidate(current: SelectorStrategy, candidate: SelectorStrategy): SelectorStrategy {
  return current.anchor && !candidate.anchor ? { ...candidate, anchor: current.anchor } : { ...candidate };
}

export function preferredSelectorCandidates(candidates: SelectorCandidate[], preference: SelectorPreference): SelectorCandidate[] {
  const preferredKinds = preferenceOrder(preference);
  return [...candidates].sort((a, b) => preferredKinds.indexOf(a.kind) - preferredKinds.indexOf(b.kind));
}

function preferenceOrder(preference: SelectorPreference): SelectorCandidate["kind"][] {
  if (preference === "css") return ["css", "role", "label", "testId", "text", "xpath", "relative", "zoomComponent"];
  if (preference === "xpath") return ["xpath", "role", "label", "testId", "text", "css", "relative", "zoomComponent"];
  if (preference === "text") return ["text", "label", "role", "testId", "css", "xpath", "relative", "zoomComponent"];
  return ["role", "label", "testId", "text", "css", "xpath", "relative", "zoomComponent"];
}
