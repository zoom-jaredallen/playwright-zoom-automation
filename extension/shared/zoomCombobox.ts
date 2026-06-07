import type { RankedSelectorCandidate, RecordedAction, SelectorCandidate, SelectorStrategy } from "@zoom-automation/workflow-core";
import { buildSelectorCandidatesForElement, testSelectorCandidatesInDocument } from "./selectorCandidates.js";

export interface ZoomComboboxSelectionInput {
  triggerElement: Element;
  optionElement: Element;
  optionText: string;
  label?: string;
}

export interface ZoomComboboxSelection {
  selectors: SelectorStrategy;
  selectorCandidates: SelectorCandidate[];
  selectedCandidateId?: string;
  selectMetadata: NonNullable<RecordedAction["selectMetadata"]>;
  rankedTriggerCandidates: RankedSelectorCandidate[];
  rankedOptionCandidates: RankedSelectorCandidate[];
}

export function buildZoomComboboxSelection(input: ZoomComboboxSelectionInput): ZoomComboboxSelection {
  const rankedTriggerCandidates = testSelectorCandidatesInDocument(
    buildSelectorCandidatesForElement(input.triggerElement),
    document,
    input.triggerElement
  );
  const rankedOptionCandidates = testSelectorCandidatesInDocument(
    optionSelectorCandidates(input.optionElement, input.optionText),
    document,
    input.optionElement
  );
  const selectedTrigger = rankedTriggerCandidates[0];
  const selectorCandidates = stripRuntimeScores(rankedTriggerCandidates);

  return {
    selectors: selectedTrigger?.selector ?? fallbackTriggerSelector(input.label),
    selectorCandidates,
    selectedCandidateId: selectedTrigger?.id,
    selectMetadata: {
      targetCandidates: selectorCandidates,
      optionCandidates: stripRuntimeScores(rankedOptionCandidates),
      optionLabel: input.optionText,
      verificationText: input.optionText
    },
    rankedTriggerCandidates,
    rankedOptionCandidates
  };
}

export function normalizeZoomOptionText(element: Element): string | undefined {
  const optionWrapper = element.closest('[class*="select-option"], [role="option"]') ?? element;
  const contentElement = optionWrapper.querySelector(
    '[class*="option__content"], [class*="tooltip__trigger"], [class*="cp-w-full"]'
  ) ?? optionWrapper;
  const parts = collectVisibleTextParts(contentElement);
  const text = joinOptionTextParts(parts) || normalizeWhitespace(contentElement.textContent ?? "");
  return text && text.length > 0 && text.length < 120 ? text : undefined;
}

function optionSelectorCandidates(element: Element, optionText: string): SelectorCandidate[] {
  const base = buildSelectorCandidatesForElement(element)
    .filter((candidate) => candidate.kind !== "label")
    .map((candidate) => (
      candidate.kind === "role" && candidate.selector.role
        ? { ...candidate, selector: { ...candidate.selector, role: { ...candidate.selector.role, exact: true } } }
        : candidate
    ));

  const exactRole: SelectorCandidate = {
    id: `role-option-${slug(optionText)}`,
    kind: "role",
    selector: { role: { role: "option", name: optionText, exact: true } },
    source: "generated",
    label: `option ${optionText}`
  };

  return [exactRole, ...base.filter((candidate) => candidate.id !== exactRole.id)];
}

function fallbackTriggerSelector(label: string | undefined): SelectorStrategy {
  return label
    ? { role: { role: "combobox", name: label }, label }
    : { role: { role: "combobox" } };
}

function stripRuntimeScores(candidates: RankedSelectorCandidate[]): SelectorCandidate[] {
  return candidates.map(({ rank: _rank, score: _score, ...candidate }) => candidate);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option";
}

function collectVisibleTextParts(root: Element): string[] {
  const parts: string[] = [];

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      const text = normalizeWhitespace(child.textContent ?? "");
      if (text) parts.push(text);
      continue;
    }

    if (!(child instanceof Element) || isHiddenFromUser(child)) {
      continue;
    }

    const childParts = collectVisibleTextParts(child);
    if (childParts.length > 0) {
      parts.push(...childParts);
      continue;
    }

    const text = normalizeWhitespace(child.textContent ?? "");
    if (text) parts.push(text);
  }

  return dedupeAdjacent(parts);
}

function joinOptionTextParts(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;

  const [primary, ...details] = parts;
  const detailText = details.join(" ");
  if (!detailText || primary.endsWith("-") || primary.endsWith(":")) {
    return normalizeWhitespace(`${primary} ${detailText}`);
  }
  return normalizeWhitespace(`${primary} - ${detailText}`);
}

function dedupeAdjacent(parts: string[]): string[] {
  const deduped: string[] = [];
  for (const part of parts.map(normalizeWhitespace).filter(Boolean)) {
    if (deduped[deduped.length - 1] !== part) deduped.push(part);
  }
  return deduped;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isHiddenFromUser(element: Element): boolean {
  return element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("hidden") !== null ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute("style") ?? "");
}
