import type { SelectorStrategy } from "./types.js";

/**
 * Extract multiple selector strategies for a DOM element, ranked by stability.
 * Enhanced for Zoom's custom component library (cpzui-*) which often puts
 * semantic information on wrapper elements rather than the clicked target.
 */
export function extractSelectors(element: Element): SelectorStrategy {
  const selectors: SelectorStrategy = {};

  // First, try the element itself
  let role = getAriaRole(element);
  let accessibleName = getAccessibleName(element);
  let label = getAssociatedLabel(element);
  let visibleText = getVisibleText(element);

  // ─── Zoom Component Traversal ──────────────────────────────────────────
  // Zoom's cpzui-* components often have the semantic info on a parent wrapper.
  // If the clicked element is an SVG, icon, or inner span, walk up to find
  // the meaningful parent.
  if (!role || !accessibleName) {
    const semanticParent = findSemanticParent(element);
    if (semanticParent && semanticParent !== element) {
      role = role ?? getAriaRole(semanticParent);
      accessibleName = accessibleName ?? getAccessibleName(semanticParent);
      label = label ?? getAssociatedLabel(semanticParent);
      if (!visibleText) {
        visibleText = getVisibleText(semanticParent);
      }
    }
  }

  // ─── Zoom Combobox/Select Detection ────────────────────────────────────
  // Detect if this element is inside a cpzui-select or cpzui-virtual-filter-select
  const zoomCombobox = detectZoomCombobox(element);
  if (zoomCombobox) {
    role = "combobox";
    accessibleName = zoomCombobox.name ?? accessibleName;
    label = zoomCombobox.name ?? label;
  }

  // ─── Zoom Option Detection ─────────────────────────────────────────────
  // Detect if this is a dropdown option being selected
  const zoomOption = detectZoomOption(element);
  if (zoomOption) {
    role = "option";
    accessibleName = zoomOption.text;
    visibleText = zoomOption.text;
  }

  const checkbox = detectCheckboxControl(element);
  if (checkbox) {
    role = "checkbox";
    accessibleName = checkbox.name ?? accessibleName;
    label = checkbox.name ?? label;
    if (checkbox.name) {
      visibleText = checkbox.name;
    }
  }

  // ─── Build Selector Strategies ─────────────────────────────────────────

  // Strategy 1: ARIA role + accessible name (most stable)
  if (role) {
    selectors.role = { role, name: accessibleName || undefined };
  }

  // Strategy 2: Label association
  if (label) {
    selectors.label = label;
  }

  // Strategy 3: Visible text (for any clickable element)
  if (visibleText) {
    selectors.text = visibleText;
  }

  // Strategy 4: data-testid (check element and parents)
  const testId = findTestId(element);
  if (testId) {
    selectors.testId = testId;
  }

  // Strategy 5: CSS selector (fallback — least stable)
  selectors.css = buildMinimalCssSelector(element);

  return selectors;
}

// ─── Zoom Component Library Awareness ────────────────────────────────────────

/**
 * Walk up the DOM to find the nearest semantically meaningful parent.
 * Zoom's cpzui-* components nest icons/spans inside buttons/wrappers.
 * We want the button, not the SVG path inside it.
 */
function findSemanticParent(element: Element): Element | undefined {
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 6) {
    // Found a button or interactive element
    if (isSemanticElement(current)) {
      return current;
    }

    // Found a Zoom component wrapper with meaningful attributes
    if (hasZoomComponentSemantics(current)) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return undefined;
}

function isSemanticElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea") return true;
  if (tag === "label" && el.querySelector("input, textarea, select")) return true;
  if (el.getAttribute("role")) return true;
  if (el.getAttribute("aria-label")) return true;
  return false;
}

function hasZoomComponentSemantics(el: Element): boolean {
  const classes = el.className ?? "";
  // Zoom button components
  if (/cpzui-button(?!__)/.test(classes)) return true;
  // Zoom select/combobox components
  if (/cpzui-select(?!-)/.test(classes) || /cpzui-virtual-filter-select(?!-)/.test(classes)) return true;
  // Zoom checkbox
  if (/cpzui-checkbox(?!__)|zm-checkbox|zmu-checkbox|checkbox/i.test(String(classes))) return true;
  // Zoom tab
  if (/cpzui-tab(?!__)/.test(classes)) return true;
  return false;
}

function detectCheckboxControl(element: Element): { name?: string } | undefined {
  const control = element.closest(
    'input[type="checkbox"], [role="checkbox"], [class*="checkbox"], [class*="Checkbox"], [class*="cpzui-checkbox"], [class*="zm-checkbox"], [class*="zmu-checkbox"]'
  );
  const label = element.closest("label");
  const labelInput = label?.querySelector('input[type="checkbox"]');
  const checkboxElement = control ?? labelInput;
  if (!checkboxElement) return undefined;

  return { name: getCheckboxName(checkboxElement, label ?? undefined) };
}

function getCheckboxName(element: Element, label?: Element): string | undefined {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text && text.length < 100) return text;
  }

  if (element.id) {
    const associated = document.querySelector(`label[for="${element.id}"]`);
    const text = associated?.textContent?.replace(/\s+/g, " ").trim();
    if (text && text.length < 100) return text;
  }

  const labelText = label?.textContent?.replace(/\s+/g, " ").trim();
  if (labelText && labelText.length < 100) return labelText;

  return undefined;
}

/**
 * Detect if the clicked element is inside a Zoom combobox/select component.
 * Returns the combobox name (label) if found.
 */
function detectZoomCombobox(element: Element): { name?: string } | undefined {
  // Look for cpzui-select or cpzui-virtual-filter-select wrapper
  const selectWrapper = element.closest(
    '[class*="cpzui-select"]:not([class*="cpzui-select-option"]), ' +
    '[class*="cpzui-virtual-filter-select"]:not([class*="cpzui-virtual-filter-select-option"])'
  );
  if (!selectWrapper) return undefined;

  // Find the label for this combobox
  const name = findComboboxLabel(selectWrapper);
  return { name };
}

/**
 * Detect if the clicked element is a dropdown option in a Zoom select.
 * Returns the option's visible text.
 */
function detectZoomOption(element: Element): { text: string } | undefined {
  // Check if inside a select-option
  const optionWrapper = element.closest(
    '[class*="cpzui-select-option"], [class*="cpzui-virtual-filter-select-option"]'
  );
  if (!optionWrapper) return undefined;

  // Extract the option text — look for the content div, tooltip trigger, or direct text
  const contentEl = optionWrapper.querySelector(
    '[class*="option__content"], [class*="tooltip__trigger"], [class*="cp-w-full"]'
  );
  const text = (contentEl ?? optionWrapper).textContent?.trim();
  if (text && text.length > 0 && text.length < 100) {
    return { text };
  }

  return undefined;
}

/**
 * Find the label for a Zoom combobox by looking at:
 * 1. aria-label on the wrapper or input
 * 2. A preceding label/heading element
 * 3. The form field group label
 */
function findComboboxLabel(wrapper: Element): string | undefined {
  // Check aria-label on the wrapper or its input
  const ariaLabel = wrapper.getAttribute("aria-label") ??
    wrapper.querySelector("input")?.getAttribute("aria-label") ??
    wrapper.querySelector("[aria-label]")?.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // Check for a label element in the same form group
  const formGroup = wrapper.closest('[class*="form-group"], [class*="field"], [class*="cp-mb"]');
  if (formGroup) {
    const label = formGroup.querySelector("label, [class*='label'], [class*='title']");
    if (label) {
      const text = label.textContent?.trim();
      if (text && text.length < 50) return text;
    }
  }

  // Check preceding sibling for a label
  const prev = wrapper.previousElementSibling;
  if (prev && (prev.tagName === "LABEL" || prev.classList.toString().includes("label"))) {
    const text = prev.textContent?.trim();
    if (text && text.length < 50) return text;
  }

  // Walk up and look for a heading in the same section
  let parent = wrapper.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    const heading = parent.querySelector(":scope > label, :scope > [class*='label'], :scope > span:first-child");
    if (heading && heading !== wrapper) {
      const text = heading.textContent?.trim();
      if (text && text.length < 50 && text.length > 1) return text;
    }
    parent = parent.parentElement;
    depth++;
  }

  return undefined;
}

// ─── Core Selector Strategies ────────────────────────────────────────────────

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

  // For buttons: look for label span inside
  if (element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button") {
    // Zoom buttons often have: <button><span class="cpzui-button__label">Text</span></button>
    const labelSpan = element.querySelector('[class*="button__label"], [class*="btn-text"]');
    if (labelSpan) {
      const text = labelSpan.textContent?.trim();
      if (text && text.length < 50) return text;
    }
    // Fallback to full text content
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
    return labelText?.replace(inputText, "").trim() || undefined;
  }

  // Zoom form field pattern: look for label in the same field group
  const fieldGroup = element.closest('[class*="form-item"], [class*="field"], [class*="cp-mb"]');
  if (fieldGroup) {
    const label = fieldGroup.querySelector(':scope > label, :scope > [class*="label"]:first-child');
    if (label) {
      const text = label.textContent?.trim();
      if (text && text.length < 50) return text;
    }
  }

  // Placeholder as last resort for inputs
  const placeholder = element.getAttribute("placeholder");
  if (placeholder) return placeholder;

  return undefined;
}

function getVisibleText(element: Element): string | undefined {
  // For Zoom buttons, prefer the label span text
  const labelSpan = element.querySelector('[class*="button__label"], [class*="btn-text"]');
  if (labelSpan) {
    const text = labelSpan.textContent?.trim();
    if (text && text.length > 0 && text.length < 80) return text;
  }

  // For option elements, get the content text
  const contentEl = element.querySelector('[class*="option__content"], [class*="tooltip__trigger"]');
  if (contentEl) {
    const text = contentEl.textContent?.trim();
    if (text && text.length > 0 && text.length < 80) return text;
  }

  // Direct text content (skip if it's too long or contains only whitespace)
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length < 80) return text;

  return undefined;
}

/**
 * Find data-testid on the element or its nearest semantic parent.
 */
function findTestId(element: Element): string | undefined {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 4) {
    const testId = current.getAttribute("data-testid") ?? current.getAttribute("data-test-id");
    if (testId) return testId;
    current = current.parentElement;
    depth++;
  }
  return undefined;
}

function buildMinimalCssSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    const tag = current.tagName.toLowerCase();
    const id = current.id;
    const classes = Array.from(current.classList)
      .filter((c) => !c.match(/^(ng-|_|js-|is-|has-|cp-)/)) // Skip framework/utility classes
      .filter((c) => !c.match(/^cpzui-.*__/)) // Skip Zoom BEM modifier classes
      .slice(0, 2);

    if (id && !id.match(/^\d|^[a-f0-9-]{20,}/)) {
      parts.unshift(`#${id}`);
      break;
    }

    let selector = tag;
    if (classes.length > 0) {
      selector += `.${classes.join(".")}`;
    }

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
  // Also check Zoom combobox context
  const zoomCombobox = detectZoomCombobox(element);

  return {
    label: zoomCombobox?.name ?? getAssociatedLabel(element),
    placeholder: element.getAttribute("placeholder") ?? undefined,
    name: element.getAttribute("name") ?? undefined,
    role: getAriaRole(element) ?? (zoomCombobox ? "combobox" : undefined),
    sectionContext: getNearestHeading(element)
  };
}

// ─── Anchors: relative selectors for table/list rows ─────────────────────────

/**
 * When the target sits inside one of several sibling rows/list-items, infer an
 * anchor: the container role + a distinctive text (email or name) so the compiled
 * flow can scope to "the row containing X". Returns undefined when there's no
 * ambiguity (single row) or no distinctive text.
 */
export function computeAnchor(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const dialogAnchor = computeDialogAnchor(element);
  if (dialogAnchor) return dialogAnchor;

  const container = element.closest('tr, [role="row"], li, [role="listitem"]');
  if (!container) return computeSectionAnchor(element);
  // Only anchor when there are sibling rows — otherwise there's nothing to disambiguate.
  const siblings = container.parentElement
    ? Array.from(container.parentElement.children).filter((c) => c.matches('tr, [role="row"], li, [role="listitem"]'))
    : [];
  if (siblings.length < 2) return undefined;

  const scopeRole = container.tagName === "TR" || container.getAttribute("role") === "row" ? "row" : "listitem";
  const text = pickAnchorText(container, element);
  if (!text) return undefined;
  return { scopeRole, text, relationship: "within", kind: scopeRole === "row" ? "row" : "listitem" };
}

function computeDialogAnchor(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const dialog = element.closest("[role='dialog'], dialog");
  if (!dialog) return undefined;
  const text = dialog.getAttribute("aria-label")?.trim()
    ?? labelledByText(dialog)
    ?? dialog.querySelector("h1, h2, h3, [class*='title'], [class*='header']")?.textContent?.replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return undefined;
  return {
    text,
    scopeRole: "dialog",
    scopeSelector: "[role='dialog'], dialog",
    relationship: "within",
    kind: "dialog"
  };
}

function computeSectionAnchor(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const section = element.closest("form, [role='form'], section, [class*='form'], [class*='section']");
  if (!section) return undefined;
  const heading = section.querySelector("legend, h1, h2, h3, [class*='title'], [class*='header']");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return undefined;
  return {
    text,
    scopeSelector: "form, [role='form'], section, [class*='form'], [class*='section']",
    relationship: "within",
    kind: section.tagName.toLowerCase() === "form" || section.getAttribute("role") === "form" ? "form" : "section"
  };
}

function labelledByText(element: Element): string | undefined {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) return undefined;
  const text = labelledBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || undefined;
}

function pickAnchorText(container: Element, target: Element): string | undefined {
  const targetCell = target.closest("td, th, [role='gridcell'], [role='cell']");
  const cells = Array.from(container.querySelectorAll("td, th, [role='gridcell'], [role='cell']"));
  const texts = (cells.length > 0 ? cells : Array.from(container.children))
    .filter((cell) => cell !== targetCell && !cell.contains(target))
    .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((t) => t.length > 1 && t.length < 60);

  const email = texts.find((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
  if (email) return email;
  const name = texts.find((t) => /^[A-Z][a-z]+(\s+[A-Z][a-z.]+)+$/.test(t));
  if (name) return name;
  return texts.find(Boolean);
}

// ─── Feature 5: ARIA state capture (idempotent toggles) ──────────────────────

/**
 * Read the desired ARIA end-state of a toggle-like element. Used so the compiled
 * flow can skip a click when the element is already in the recorded state.
 */
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

// ─── Feature 1: iframe / frameLocator capture ────────────────────────────────

/**
 * When the recorder runs inside a same-origin iframe, return a CSS selector that
 * locates that iframe from the parent document so the compiler can emit
 * page.frameLocator(...). Returns undefined for the top frame or cross-origin
 * frames (where window.frameElement is inaccessible).
 */
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
    } catch { /* fall through */ }
  }

  const sameTag = Array.from(document.querySelectorAll(frameEl.tagName.toLowerCase()));
  const index = sameTag.indexOf(frameEl);
  return index >= 0 ? `${frameEl.tagName.toLowerCase()}:nth-of-type(${index + 1})` : frameEl.tagName.toLowerCase();
}

// ─── Feature 3: nth disambiguation ───────────────────────────────────────────

/**
 * If the most stable available selector matches several elements, return the
 * 0-based index of the target so the compiler can emit .nth(i) instead of
 * .first(). Returns undefined when the target is the first/only match.
 */
export function computeNth(element: Element, selectors: SelectorStrategy): number | undefined {
  const matches = resolvePrimaryMatches(selectors);
  if (matches.length <= 1) return undefined;

  const index = matches.findIndex((candidate) => candidate === element || candidate.contains(element) || element.contains(candidate));
  return index > 0 ? index : undefined;
}

/**
 * Resolve the candidate elements for the highest-priority selector strategy,
 * mirroring the compiler's strategy order (role → label → text → testId → css).
 */
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
    } catch { /* invalid selector */ }
  }

  return [];
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
