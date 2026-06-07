import type { SelectorCandidate, SelectorCandidateScore, SelectorStrategy } from "../types.js";

export function scoreSelectorCandidate(candidate: SelectorCandidate): SelectorCandidateScore {
  const reasons: string[] = [];
  let score = baseKindScore(candidate, reasons);
  const selector = candidate.selector;
  const diagnostics = candidate.diagnostics;

  if (selector.role?.exact) {
    score += 8;
    reasons.push("Exact accessible-name match");
  }
  if (selector.anchor?.text) {
    score += diagnostics?.anchorReducedMatches ? 18 : 10;
    reasons.push(diagnostics?.anchorReducedMatches ? "Anchor narrows matches" : "Anchored selector");
  }
  if (hasAriaState(selector)) {
    score += 8;
    reasons.push("ARIA-state constrained");
  }
  if (typeof selector.nth === "number") {
    score -= 22;
    reasons.push("Uses positional nth fallback");
  }

  if (diagnostics) {
    const matched = diagnostics.matchedCount;
    const visible = diagnostics.visibleCount;
    if (diagnostics.uniquelyIdentifiesTarget || (matched === 1 && visible === 1)) {
      score += 22;
      reasons.push("Unique visible live match");
    } else if (visible === 1) {
      score += 12;
      reasons.push("One visible live match");
    } else if ((visible ?? 0) > 1) {
      score -= Math.min(30, (visible ?? 0) * 6);
      reasons.push(`Ambiguous: ${visible} visible matches`);
    } else if (matched === 0 || visible === 0) {
      score -= 35;
      reasons.push("No visible live match");
    }
    if (diagnostics.brittleReason) {
      score -= 20;
      reasons.push(diagnostics.brittleReason);
    }
  }

  if (looksBrittleCss(selector.css)) {
    score -= 18;
    reasons.push("CSS appears generated or positional");
  }
  if (looksBrittleXPath(selector.xpath)) {
    score -= 20;
    reasons.push("XPath appears positional");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: score >= 75 ? "high" : score >= 50 ? "medium" : "low", reasons };
}

function baseKindScore(candidate: SelectorCandidate, reasons: string[]): number {
  switch (candidate.kind) {
    case "testId":
      reasons.push("Stable test id");
      return 72;
    case "role":
      reasons.push(candidate.selector.role?.name ? "ARIA role + accessible name" : "ARIA role");
      return candidate.selector.role?.name ? 66 : 38;
    case "label":
      reasons.push("Form-label association");
      return 60;
    case "zoomComponent":
      reasons.push("Zoom component selector");
      return 56;
    case "relative":
      reasons.push("Relative selector");
      return 52;
    case "text":
      reasons.push("Visible text selector");
      return 48;
    case "css":
      reasons.push("CSS selector");
      return 34;
    case "xpath":
      reasons.push("XPath selector");
      return 30;
  }
}

function hasAriaState(selector: SelectorStrategy): boolean {
  const role = selector.role;
  return Boolean(role && (role.checked !== undefined || role.expanded !== undefined || role.selected !== undefined || role.pressed !== undefined));
}

function looksBrittleCss(css: string | undefined): boolean {
  if (!css) return false;
  return /:nth-|>\s*[^[]|zoom-id-\d+|_[a-z0-9]{5,}|--[a-z0-9]{4,}/i.test(css);
}

function looksBrittleXPath(xpath: string | undefined): boolean {
  if (!xpath) return false;
  return /\/\w+\[\d+\]|\/\*\[\d+\]/.test(xpath);
}
