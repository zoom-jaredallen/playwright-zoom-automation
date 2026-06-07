import type { RecordedAction } from "@zoom-automation/workflow-core";

const DUPLICATE_NAVIGATION_WINDOW_MS = 1_500;
const DUPLICATE_FILL_WINDOW_MS = 5_000;

export function insertRecordedAction(actions: RecordedAction[], action: RecordedAction): RecordedAction[] {
  if (isDuplicateNavigationAction(actions, action)) {
    return actions;
  }
  if (isDuplicateFillAction(actions, action)) {
    return actions;
  }
  return [...actions, action].sort(compareRecordedActionOrder);
}

export function prepareRecordedActionsForWorkflow(actions: RecordedAction[]): RecordedAction[] {
  const sorted = [...actions].sort(compareRecordedActionOrder);
  const collapsed: RecordedAction[] = [];

  for (const action of sorted) {
    const previous = collapsed.at(-1);
    if (previous && areSameNavigationDestination(previous, action)) {
      continue;
    }
    if (previous && areSameFillTargetAndValue(previous, action)) {
      continue;
    }
    collapsed.push(action);
  }

  return collapsed;
}

function isDuplicateNavigationAction(actions: RecordedAction[], action: RecordedAction): boolean {
  if (action.type !== "navigate") return false;
  return actions.some((existing) => (
    areSameNavigationDestination(existing, action)
    && Math.abs((existing.timestamp ?? 0) - (action.timestamp ?? 0)) <= DUPLICATE_NAVIGATION_WINDOW_MS
  ));
}

function isDuplicateFillAction(actions: RecordedAction[], action: RecordedAction): boolean {
  if (action.type !== "fill") return false;
  return actions.some((existing) => (
    areSameFillTargetAndValue(existing, action)
    && Math.abs((existing.timestamp ?? 0) - (action.timestamp ?? 0)) <= DUPLICATE_FILL_WINDOW_MS
  ));
}

function areSameNavigationDestination(a: RecordedAction, b: RecordedAction): boolean {
  if (a.type !== "navigate" || b.type !== "navigate") return false;
  const aUrl = canonicalNavigationUrl(a);
  const bUrl = canonicalNavigationUrl(b);
  return Boolean(aUrl && bUrl && aUrl === bUrl);
}

function areSameFillTargetAndValue(a: RecordedAction, b: RecordedAction): boolean {
  if (a.type !== "fill" || b.type !== "fill") return false;
  if ((a.value ?? "") !== (b.value ?? "")) return false;
  return haveSameDurableTarget(a, b) || haveSameFillDescriptionTarget(a, b);
}

function haveSameDurableTarget(a: RecordedAction, b: RecordedAction): boolean {
  if (a.selectedCandidateId && b.selectedCandidateId && a.selectedCandidateId === b.selectedCandidateId) {
    return true;
  }

  const aSelectors = durableFillSelectorSignatures(a);
  const bSelectors = durableFillSelectorSignatures(b);
  return aSelectors.some((signature) => bSelectors.includes(signature));
}

function haveSameFillDescriptionTarget(a: RecordedAction, b: RecordedAction): boolean {
  const aTarget = fillDescriptionTarget(a.description);
  const bTarget = fillDescriptionTarget(b.description);
  return Boolean(aTarget && bTarget && aTarget === bTarget);
}

function fillDescriptionTarget(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const match = description.match(/^Fill\s+"([^"]+)"\s+with\s+"/i);
  return match?.[1] ? normaliseSelectorText(match[1]) : undefined;
}

function durableFillSelectorSignatures(action: RecordedAction): string[] {
  const selectors = action.selectors;
  const signatures: string[] = [];

  if (selectors.role?.role && selectors.role.name) {
    signatures.push(`role:${selectors.role.role}:${normaliseSelectorText(selectors.role.name)}`);
  }
  if (selectors.label) {
    signatures.push(`label:${normaliseSelectorText(selectors.label)}`);
  }
  if (selectors.anchor?.kind && selectors.anchor.text) {
    signatures.push(`anchor:${selectors.anchor.kind}:${normaliseSelectorText(selectors.anchor.text)}`);
  }
  if (selectors.testId) {
    signatures.push(`testid:${selectors.testId}`);
  }

  return signatures;
}

function normaliseSelectorText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function canonicalNavigationUrl(action: RecordedAction): string | undefined {
  const raw = action.url ?? action.pageUrl;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw, "https://zoom.us");
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function compareRecordedActionOrder(a: RecordedAction, b: RecordedAction): number {
  const timestampDiff = (a.timestamp ?? 0) - (b.timestamp ?? 0);
  if (timestampDiff !== 0) return timestampDiff;
  return a.id.localeCompare(b.id);
}
