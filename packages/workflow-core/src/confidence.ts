/**
 * Static selector-confidence heuristic. Scores how reliably a SelectorStrategy
 * will resolve a single, correct element — without touching a live page — so the
 * editor can flag ambiguous/fragile selectors (à la RPA confidence indicators).
 */
import type { SelectorStrategy } from "./types.js";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface SelectorConfidence {
  score: number; // 0–100
  level: ConfidenceLevel;
  reasons: string[];
}

export function scoreSelector(selectors: SelectorStrategy | undefined): SelectorConfidence {
  const reasons: string[] = [];
  let score = 0;

  if (!selectors || Object.keys(selectors).length === 0) {
    return { score: 0, level: "low", reasons: ["No selector strategies captured"] };
  }

  if (selectors.testId) {
    score += 75;
    reasons.push("Stable test id");
  }
  if (selectors.role?.name) {
    score += 60;
    reasons.push("ARIA role + accessible name");
    if (selectors.role.exact) {
      score += 10;
      reasons.push("Exact name match");
    }
  } else if (selectors.role) {
    score += 20;
    reasons.push("ARIA role without a name (may match several)");
  }
  if (selectors.label) {
    score += 45;
    reasons.push("Form-label association");
  }
  if (selectors.anchor?.text) {
    score += 25;
    reasons.push(`Anchored to ${selectors.anchor.scopeRole ?? "row"} containing "${selectors.anchor.text}"`);
  }
  if (selectors.text) {
    score += 40;
    reasons.push("Visible text");
  }
  if (hasAriaState(selectors)) {
    score += 10;
    reasons.push("ARIA-state constrained");
  }
  if (selectors.css) {
    score += 10;
    reasons.push("CSS fallback available");
  }
  if (typeof selectors.nth === "number") {
    score -= 20;
    reasons.push("Relies on a positional index (nth) — brittle if the list reorders");
  }

  score = Math.max(0, Math.min(100, score));
  const level: ConfidenceLevel = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, level, reasons };
}

function hasAriaState(selectors: SelectorStrategy): boolean {
  const role = selectors.role;
  return Boolean(
    role && (role.checked !== undefined || role.expanded !== undefined || role.selected !== undefined || role.pressed !== undefined)
  );
}
