import type { SelectorCandidate, SelectorCandidateKind, SelectorStrategy } from "../types.js";

export function selectorCandidatesFromStrategy(
  selectors: SelectorStrategy | undefined,
  source: SelectorCandidate["source"] = "legacy"
): SelectorCandidate[] {
  if (!selectors) return [];
  const candidates: SelectorCandidate[] = [];
  const add = (kind: SelectorCandidateKind, selector: SelectorStrategy, label: string) => {
    candidates.push({
      id: candidateId(kind, label),
      kind,
      selector,
      source,
      label
    });
  };
  const withSharedContext = (selector: SelectorStrategy): SelectorStrategy => ({
    ...selector,
    ...(selectors.anchor ? { anchor: selectors.anchor } : {}),
    ...(selectors.nth !== undefined ? { nth: selectors.nth } : {})
  });

  if (selectors.role) {
    const name = selectors.role.name ? ` ${selectors.role.name}` : "";
    add("role", withSharedContext({ role: selectors.role }), `${selectors.role.role}${name}`.trim());
  }
  if (selectors.label) add("label", withSharedContext({ label: selectors.label }), selectors.label);
  if (selectors.testId) add("testId", withSharedContext({ testId: selectors.testId }), selectors.testId);
  if (selectors.text) add("text", withSharedContext({ text: selectors.text }), selectors.text);
  if (selectors.css) add("css", withSharedContext({ css: selectors.css }), selectors.css);
  if (selectors.xpath) add("xpath", withSharedContext({ xpath: selectors.xpath }), selectors.xpath);

  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: SelectorCandidate[]): SelectorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify({ kind: candidate.kind, selector: candidate.selector });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateId(kind: SelectorCandidateKind, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug ? `${kind}-${slug}` : kind;
}
