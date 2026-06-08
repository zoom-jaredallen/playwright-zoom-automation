import type { FrameLocator, Locator, Page } from "playwright";
import {
  rankSelectorCandidates,
  selectorCandidatesFromStrategy,
  type RankedSelectorCandidate,
  type SelectorCandidate,
  type SelectorStrategy
} from "@zoom-automation/workflow-core";
import { createSelectorResolutionDiagnostics } from "./selectorDiagnostics.js";
import type { SelectorResolutionDiagnostics, SelectorResolutionPlanEntry, SelectorResolutionResult } from "./types.js";

type SelectorRoot = Page | FrameLocator | Locator;

export { createSelectorResolutionDiagnostics };
export type { SelectorResolutionDiagnostics, SelectorResolutionPlanEntry, SelectorResolutionResult };

export function buildSelectorResolutionPlan(
  selectors: SelectorStrategy,
  selectorCandidates: SelectorCandidate[] = []
): SelectorResolutionPlanEntry[] {
  const candidates = dedupeCandidates([
    ...selectorCandidates,
    ...selectorCandidatesFromStrategy(selectors, "legacy")
  ]);
  return rankSelectorCandidates(candidates).map((candidate) => ({
    ...candidate,
    candidate,
    strategyName: strategyName(candidate)
  }));
}

export async function resolveSelector(
  root: SelectorRoot,
  selectors: SelectorStrategy,
  selectorCandidates: SelectorCandidate[] = [],
  timeout = 5_000
): Promise<SelectorResolutionResult> {
  const startedAt = Date.now();
  const plan = buildSelectorResolutionPlan(selectors, selectorCandidates);
  const requestedStrategies = plan.map((entry) => entry.strategyName);
  const warnings: string[] = [];

  for (const entry of plan) {
    const locator = locatorFor(root, entry.candidate.selector);
    const matchedCount = await locator.count().catch(() => 0);
    const visibleCount = await countVisible(locator, Math.min(timeout, 1_000));
    if (visibleCount === 0) {
      warnings.push(`${entry.strategyName}: no visible matches`);
      continue;
    }
    if (visibleCount > 1) warnings.push(`Ambiguous: ${visibleCount} visible matches`);

    const selected = pick(locator, entry.candidate.selector.nth);
    await selected.waitFor({ state: "visible", timeout: Math.min(timeout, 3_000) });
    return {
      locator: selected,
      diagnostics: createSelectorResolutionDiagnostics({
        requestedStrategies,
        selectedStrategy: entry.strategyName,
        selectedRank: entry.rank,
        matchedCount,
        visibleCount,
        elapsedMs: Date.now() - startedAt,
        warnings
      })
    };
  }

  throw new Error(`Element not found with ranked selector plan: ${JSON.stringify({ selectors, requestedStrategies, warnings })}`);
}

function locatorFor(root: SelectorRoot, selectors: SelectorStrategy): Locator {
  const scopedRoot = resolveAnchorScope(root, selectors);
  const nth = selectors.nth;
  if (selectors.testId) return pick(scopedRoot.getByTestId(selectors.testId), nth);
  if (selectors.role) {
    const { role, name, exact, checked, expanded, selected, pressed } = selectors.role;
    const options: Record<string, unknown> = {};
    if (name) {
      options.name = exact ? name : new RegExp(escapeRegex(name), "i");
      if (exact) options.exact = true;
    }
    if (checked !== undefined) options.checked = checked;
    if (expanded !== undefined) options.expanded = expanded;
    if (selected !== undefined) options.selected = selected;
    if (pressed !== undefined) options.pressed = pressed;
    return pick(scopedRoot.getByRole(role as never, options), nth);
  }
  if (selectors.label) return pick(scopedRoot.getByLabel(new RegExp(escapeRegex(selectors.label), "i")), nth);
  if (selectors.text) return pick(scopedRoot.getByText(new RegExp(escapeRegex(selectors.text), "i")), nth);
  if (selectors.css) return pick(scopedRoot.locator(selectors.css), nth);
  if (selectors.xpath) return pick(scopedRoot.locator(`xpath=${selectors.xpath}`), nth);
  return scopedRoot.locator("body").first();
}

function resolveAnchorScope(root: SelectorRoot, selectors: SelectorStrategy): SelectorRoot {
  const anchor = selectors.anchor;
  if (!anchor || (!anchor.text && !anchor.scopeRole && !anchor.scopeSelector)) return root;

  let container: Locator;
  if (anchor.scopeSelector) {
    container = root.locator(anchor.scopeSelector);
  } else {
    container = root.getByRole((anchor.scopeRole ?? "row") as never);
  }
  if (anchor.text) {
    container = container.filter({ hasText: new RegExp(escapeRegex(anchor.text), "i") });
  }
  return container.first();
}

function pick(locator: Locator, nth: number | undefined): Locator {
  return typeof nth === "number" ? locator.nth(nth) : locator.first();
}

async function countVisible(locator: Locator, timeout: number): Promise<number> {
  const count = await locator.count().catch(() => 0);
  let visible = 0;
  for (let index = 0; index < count; index++) {
    if (await locator.nth(index).isVisible({ timeout }).catch(() => false)) visible += 1;
  }
  return visible;
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

function strategyName(candidate: RankedSelectorCandidate): string {
  return candidate.id || `${candidate.kind}:${candidate.label ?? candidate.rank}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
