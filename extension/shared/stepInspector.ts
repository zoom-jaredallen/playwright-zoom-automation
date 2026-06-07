import { scoreSelector, type RecordedAction, type SelectorCandidate } from "@zoom-automation/workflow-core";

export interface StepInspectorSummary {
  hasThumbnail: boolean;
  thumbnail?: {
    dataUrl: string;
    width: number;
    height: number;
  };
  targetPreview: string;
  anchorLabel: string;
  matchLabel: string;
  confidenceLabel: string;
  confidenceLevel: "high" | "medium" | "low";
  chosenSelectorLabel: string;
  fallbackCount: number;
}

export function buildStepInspectorSummary(action: RecordedAction): StepInspectorSummary {
  const confidence = action.selectorDiagnostics?.confidence ?? scoreSelector(action.selectors);
  const chosenCandidateId = action.selectorDiagnostics?.chosenCandidateId ?? action.selectedCandidateId;
  const chosenCandidate = chosenCandidateId ? action.selectorCandidates?.find((candidate) => candidate.id === chosenCandidateId) : undefined;
  const fallbackCount = fallbackCandidates(action.selectorCandidates ?? [], chosenCandidate?.id).length;

  return {
    hasThumbnail: Boolean(action.capture?.thumbnail?.dataUrl),
    thumbnail: action.capture?.thumbnail,
    targetPreview: action.selectorDiagnostics?.targetPreview ?? action.capture?.targetBox ? action.selectorDiagnostics?.targetPreview ?? "Captured element" : "No captured element",
    anchorLabel: formatAnchor(action),
    matchLabel: formatMatches(action.selectorDiagnostics?.matchedCount, action.selectorDiagnostics?.visibleCount),
    confidenceLabel: `${confidence.score}/100 ${confidence.level}`,
    confidenceLevel: confidence.level,
    chosenSelectorLabel: chosenCandidate?.label ?? formatChosenSelector(action),
    fallbackCount
  };
}

export function fallbackCandidates(candidates: SelectorCandidate[], chosenCandidateId?: string): SelectorCandidate[] {
  return candidates.filter((candidate) => candidate.id !== chosenCandidateId);
}

function formatAnchor(action: RecordedAction): string {
  const anchor = action.selectorDiagnostics?.anchor ?? action.selectors.anchor;
  if (!anchor?.text) return "No anchor";
  const relationship = anchor.relationship ?? "within";
  const scope = anchor.scopeRole ?? "row";
  return `${relationship} ${scope} containing "${anchor.text}"`;
}

function formatMatches(matchedCount: number | undefined, visibleCount: number | undefined): string {
  if (matchedCount === undefined || visibleCount === undefined) return "Not tested on current page";
  return `${matchedCount} matched, ${visibleCount} visible`;
}

function formatChosenSelector(action: RecordedAction): string {
  const selectors = action.selectors;
  if (selectors.role) return `Role: ${selectors.role.role}${selectors.role.name ? ` "${selectors.role.name}"` : ""}`;
  if (selectors.label) return `Label: ${selectors.label}`;
  if (selectors.testId) return `Test id: ${selectors.testId}`;
  if (selectors.text) return `Text: ${selectors.text}`;
  if (selectors.xpath) return `XPath: ${selectors.xpath}`;
  if (selectors.css) return `CSS: ${selectors.css}`;
  return "No selector";
}
