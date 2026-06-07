import {
  rankSelectorCandidates,
  selectorCandidatesFromStrategy,
  type RankedSelectorCandidate,
  type SelectorCandidate,
  type SelectorStrategy
} from "@zoom-automation/workflow-core";
import { computeAnchor, extractSelectors } from "./selectors.js";

export function buildSelectorCandidatesForElement(element: Element): SelectorCandidate[] {
  const selectors = extractSelectors(element);
  const anchor = computeAnchor(element);
  const withXPath: SelectorStrategy = {
    ...selectors,
    ...(anchor ? { anchor } : {}),
    xpath: buildShortXPath(element)
  };
  return selectorCandidatesFromStrategy(withXPath, "recorded");
}

export function testSelectorCandidatesInDocument(
  candidates: SelectorCandidate[],
  root: Document | Element = document,
  target?: Element
): RankedSelectorCandidate[] {
  const tested = candidates.map((candidate) => {
    const matches = resolveSelectorCandidate(candidate.selector, root);
    const visible = matches.filter(isVisible);
    return {
      ...candidate,
      diagnostics: {
        ...candidate.diagnostics,
        matchedCount: matches.length,
        visibleCount: visible.length,
        uniquelyIdentifiesTarget: target ? visible.some((element) => isSameTarget(element, target)) && visible.length === 1 : visible.length === 1,
        anchorReducedMatches: Boolean(candidate.selector.anchor?.text && matches.length <= 1),
        chosenPreview: visible[0] ? previewElement(visible[0]) : undefined
      }
    };
  });
  return rankSelectorCandidates(tested);
}

export function resolveSelectorCandidate(selector: SelectorStrategy, root: Document | Element = document): Element[] {
  const scope = resolveAnchorRoot(selector, root) ?? root;
  if (selector.role) return findByRole(scope, selector.role.role, selector.role.name, selector.role.exact);
  if (selector.label) {
    const labelled = findByLabel(scope, selector.label);
    return labelled ? [labelled] : [];
  }
  if (selector.testId) return queryAll(scope, `[data-testid="${cssEscape(selector.testId)}"], [data-test-id="${cssEscape(selector.testId)}"]`);
  if (selector.text) {
    const needle = selector.text.toLowerCase();
    return queryAll(scope, "*").filter((element) => visibleText(element).toLowerCase().includes(needle));
  }
  if (selector.css) return safeQueryAll(scope, selector.css);
  if (selector.xpath) return findByXPath(selector.xpath, ownerDocument(scope));
  return [];
}

function resolveAnchorRoot(selector: SelectorStrategy, root: Document | Element): Element | undefined {
  const anchor = selector.anchor;
  if (!anchor?.text) return undefined;
  const candidates = anchor.scopeSelector
    ? safeQueryAll(root, anchor.scopeSelector)
    : findByRole(root, anchor.scopeRole ?? "row", undefined, false);
  const text = anchor.text.toLowerCase();
  return candidates.find((candidate) => visibleText(candidate).toLowerCase().includes(text));
}

function findByRole(root: Document | Element, role: string, name?: string, exact?: boolean): Element[] {
  const doc = ownerDocument(root);
  const selector = roleToSelector(role);
  const matches = safeQueryAll(root, selector);
  if (!name) return matches;
  const needle = name.toLowerCase();
  return matches.filter((element) => {
    const accessible = accessibleName(element, doc).toLowerCase();
    return exact ? accessible === needle : accessible.includes(needle);
  });
}

function findByLabel(root: Document | Element, label: string): Element | undefined {
  const needle = label.toLowerCase();
  const labels = safeQueryAll(root, "label");
  for (const labelElement of labels) {
    if (!visibleText(labelElement).toLowerCase().includes(needle)) continue;
    const forId = labelElement.getAttribute("for");
    if (forId) {
      const control = ownerDocument(root).getElementById(forId);
      if (control) return control;
    }
    const nested = labelElement.querySelector("input, textarea, select, [role='combobox'], [role='textbox']");
    if (nested) return nested;
  }
  return safeQueryAll(root, "[aria-label]").find((element) => (element.getAttribute("aria-label") ?? "").toLowerCase().includes(needle));
}

function roleToSelector(role: string): string {
  if (role === "button") return "button, [role='button'], input[type='button'], input[type='submit']";
  if (role === "textbox") return "input:not([type]), input[type='text'], input[type='email'], input[type='password'], textarea, [role='textbox']";
  if (role === "combobox") return "select, [role='combobox'], input[role='combobox'], [aria-haspopup='listbox']";
  if (role === "checkbox") return "input[type='checkbox'], [role='checkbox'], label:has(input[type='checkbox']), [class*='checkbox'], [class*='Checkbox']";
  if (role === "row") return "tr, [role='row']";
  if (role === "listitem") return "li, [role='listitem']";
  if (role === "option") return "option, [role='option'], li, [class*='option']";
  return `[role='${cssEscape(role)}']`;
}

function accessibleName(element: Element, doc: Document): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  const fromLabelledBy = labelledBy
    ?.split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (fromLabelledBy) return fromLabelledBy;

  const aria = element.getAttribute("aria-label");
  if (aria) return aria;

  if (element.id) {
    const label = doc.querySelector(`label[for="${cssEscape(element.id)}"]`);
    if (label?.textContent) return label.textContent.trim();
  }
  return visibleText(element);
}

function buildShortXPath(element: Element): string {
  if (element.id && !/^\d|^[a-f0-9-]{20,}/i.test(element.id)) {
    return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === current.ELEMENT_NODE && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((child): child is Element => child instanceof Element && child.tagName === current!.tagName);
    const index = sameTag.length > 1 ? `[${sameTag.indexOf(current) + 1}]` : "";
    parts.unshift(`${tag}${index}`);
    current = parent;
  }
  return `//${parts.join("/")}`;
}

function findByXPath(xpath: string, doc: Document): Element[] {
  const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const matches: Element[] = [];
  for (let index = 0; index < result.snapshotLength; index++) {
    const node = result.snapshotItem(index);
    if (node instanceof doc.defaultView!.Element) matches.push(node);
  }
  return matches;
}

function queryAll(root: Document | Element, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

function safeQueryAll(root: Document | Element, selector: string): Element[] {
  try {
    return queryAll(root, selector);
  } catch {
    return [];
  }
}

function ownerDocument(root: Document | Element): Document {
  return root instanceof Document ? root : root.ownerDocument;
}

function visibleText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(element: Element): boolean {
  const hidden = element.getAttribute("hidden") !== null || element.getAttribute("aria-hidden") === "true";
  const style = element.getAttribute("style") ?? "";
  return !hidden && !/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function isSameTarget(candidate: Element, target: Element): boolean {
  return candidate === target || candidate.contains(target) || target.contains(candidate);
}

function previewElement(element: Element): string {
  const text = visibleText(element);
  const label = text ? ` "${text.slice(0, 80)}"` : "";
  return `<${element.tagName.toLowerCase()}${label}>`;
}

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
