import type { SelectorStrategy } from "./types.js";

/**
 * Extract multiple selector strategies for a DOM element, ranked by stability.
 * The recorder captures all available strategies; the compiler uses the best one
 * with fallbacks.
 */
export function extractSelectors(element: Element): SelectorStrategy {
  const selectors: SelectorStrategy = {};

  // Strategy 1: ARIA role + accessible name (most stable)
  const role = getAriaRole(element);
  const accessibleName = getAccessibleName(element);
  if (role) {
    selectors.role = { role, name: accessibleName || undefined };
  }

  // Strategy 2: Label association
  const label = getAssociatedLabel(element);
  if (label) {
    selectors.label = label;
  }

  // Strategy 3: Visible text (for buttons/links)
  const visibleText = getVisibleText(element);
  if (visibleText && isClickTarget(element)) {
    selectors.text = visibleText;
  }

  // Strategy 4: data-testid
  const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test-id");
  if (testId) {
    selectors.testId = testId;
  }

  // Strategy 5: CSS selector (fallback — least stable)
  selectors.css = buildMinimalCssSelector(element);

  return selectors;
}

function getAriaRole(element: Element): string | undefined {
  // Explicit role
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;

  // Implicit roles from tag
  const tag = element.tagName.toLowerCase();
  const implicitRoles: Record<string, string> = {
    button: "button",
    a: "link",
    input: getInputRole(element),
    select: "combobox",
    textarea: "textbox",
    dialog: "dialog",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo"
  };

  return implicitRoles[tag];
}

function getInputRole(element: Element): string {
  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  const roles: Record<string, string> = {
    text: "textbox",
    email: "textbox",
    password: "textbox",
    search: "searchbox",
    number: "spinbutton",
    checkbox: "checkbox",
    radio: "radio",
    file: "button"
  };
  return roles[type] ?? "textbox";
}

function getAccessibleName(element: Element): string | undefined {
  // aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim();
  }

  // For inputs: associated <label>
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.trim();
    }
  }

  // For buttons: text content
  if (element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button") {
    const text = element.textContent?.trim();
    if (text && text.length < 50) return text;
  }

  return undefined;
}

function getAssociatedLabel(element: Element): string | undefined {
  // Direct aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // <label for="id">
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim();
  }

  // Parent <label>
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const labelText = parentLabel.textContent?.trim();
    const inputText = element.textContent?.trim() ?? (element as HTMLInputElement).value ?? "";
    // Remove the input's own text from the label
    return labelText?.replace(inputText, "").trim() || undefined;
  }

  // Placeholder as last resort for inputs
  const placeholder = element.getAttribute("placeholder");
  if (placeholder) return placeholder;

  return undefined;
}

function getVisibleText(element: Element): string | undefined {
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length < 80) return text;
  return undefined;
}

function isClickTarget(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "button" || tag === "a" || element.getAttribute("role") === "button";
}

function buildMinimalCssSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    const tag = current.tagName.toLowerCase();
    const id = current.id;
    const classes = Array.from(current.classList)
      .filter((c) => !c.match(/^(ng-|_|js-|is-|has-)/)) // Skip framework classes
      .slice(0, 2);

    if (id && !id.match(/^\d|^[a-f0-9-]{20,}/)) {
      // Usable ID (not auto-generated)
      parts.unshift(`#${id}`);
      break;
    }

    let selector = tag;
    if (classes.length > 0) {
      selector += `.${classes.join(".")}`;
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return parts.join(" > ");
}

/**
 * Get the field context for parameterization analysis.
 */
export function getFieldContext(element: Element): {
  label?: string;
  placeholder?: string;
  name?: string;
  role?: string;
  sectionContext?: string;
} {
  return {
    label: getAssociatedLabel(element),
    placeholder: element.getAttribute("placeholder") ?? undefined,
    name: element.getAttribute("name") ?? undefined,
    role: getAriaRole(element),
    sectionContext: getNearestHeading(element)
  };
}

function getNearestHeading(element: Element): string | undefined {
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 6) {
    const heading = current.querySelector("h1, h2, h3, h4, h5, h6, [class*='title'], [class*='header']");
    if (heading) return heading.textContent?.trim();
    current = current.parentElement;
    depth++;
  }
  return undefined;
}
