import type { SelectorStrategy } from "./types.js";
import { findSemanticParent } from "./selectorSemantic.js";

export function getAriaState(
  element: Element
): { checked?: boolean; expanded?: boolean; selected?: boolean } | undefined {
  const semantic = findSemanticParent(element) ?? element;
  const read = (attr: string): boolean | undefined => {
    const value = semantic.getAttribute(attr) ?? element.getAttribute(attr);
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  };

  const nativeChecked =
    element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
      ? element.checked
      : undefined;

  const state = {
    checked: read("aria-checked") ?? nativeChecked,
    expanded: read("aria-expanded"),
    selected: read("aria-selected")
  };

  if (state.checked === undefined && state.expanded === undefined && state.selected === undefined) {
    return undefined;
  }
  return state;
}

export function getFrameSelector(): string | undefined {
  try {
    if (window.top === window.self) return undefined;
    const frameEl = window.frameElement;
    if (!frameEl) return undefined;
    return buildFrameCssSelector(frameEl);
  } catch {
    return undefined;
  }
}

function buildFrameCssSelector(frameEl: Element): string {
  if (frameEl.id && !/^\d|^[a-f0-9-]{20,}/.test(frameEl.id)) {
    return `#${frameEl.id}`;
  }
  const name = frameEl.getAttribute("name");
  if (name) return `iframe[name="${name.replace(/"/g, '\\"')}"]`;

  const src = frameEl.getAttribute("src");
  if (src) {
    try {
      const path = new URL(src, window.location.href).pathname;
      if (path && path !== "/") return `iframe[src*="${path.replace(/"/g, '\\"')}"]`;
    } catch {
      // Fall through to nth-of-type selector.
    }
  }

  const sameTag = Array.from(document.querySelectorAll(frameEl.tagName.toLowerCase()));
  const index = sameTag.indexOf(frameEl);
  return index >= 0 ? `${frameEl.tagName.toLowerCase()}:nth-of-type(${index + 1})` : frameEl.tagName.toLowerCase();
}

export function computeNth(element: Element, selectors: SelectorStrategy): number | undefined {
  const matches = resolvePrimaryMatches(selectors);
  if (matches.length <= 1) return undefined;

  const index = matches.findIndex((candidate) => candidate === element || candidate.contains(element) || element.contains(candidate));
  return index > 0 ? index : undefined;
}

function resolvePrimaryMatches(selectors: SelectorStrategy): Element[] {
  if (selectors.role) {
    const tagFilter =
      selectors.role.role === "button"
        ? "button, [role='button'], input[type='button'], input[type='submit']"
        : selectors.role.role === "textbox"
          ? "input, textarea, [role='textbox']"
          : selectors.role.role === "checkbox"
            ? "input[type='checkbox'], [role='checkbox'], label:has(input[type='checkbox']), [class*='checkbox'], [class*='Checkbox']"
            : `[role='${selectors.role.role}']`;
    const name = selectors.role.name?.toLowerCase();
    const matches = Array.from(document.querySelectorAll(tagFilter)).filter((el) => {
      if (!name) return true;
      const accessible = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`.toLowerCase();
      return accessible.includes(name);
    });
    if (matches.length > 0) return matches;
  }

  if (selectors.text) {
    const text = selectors.text.toLowerCase();
    return Array.from(document.querySelectorAll("button, a, [role='button'], [role='option'], td, li, span"))
      .filter((el) => (el.textContent ?? "").trim().toLowerCase().includes(text));
  }

  if (selectors.css) {
    try {
      return Array.from(document.querySelectorAll(selectors.css));
    } catch {
      // Invalid selector.
    }
  }

  return [];
}
