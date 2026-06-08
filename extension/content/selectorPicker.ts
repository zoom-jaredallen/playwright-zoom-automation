import { computeAnchor, computeNth, extractSelectors } from "../shared/selectors.js";
import { buildSelectorCandidatesForElement, testSelectorCandidatesInDocument } from "../shared/selectorCandidates.js";
import type { AnchorPickResult, RecordedAction, SelectorPickResult, SelectorStrategy } from "../shared/types.js";
import {
  CHECKBOX_TARGET_SELECTOR,
  bestCheckboxTarget,
  elementPreview,
  highlightElement,
  isElementVisible,
  isRecorderUI,
  visibleText
} from "./domHelpers.js";
import { stripRuntimeScores } from "./replayRunner.js";

let activeSelectorPick: { cancel: (message: string) => void } | undefined;

export function isSelectorPicking(): boolean {
  return Boolean(activeSelectorPick);
}

export async function pickSelector(action: RecordedAction, frameSelector: string | undefined): Promise<SelectorPickResult> {
  activeSelectorPick?.cancel("Replaced by a newer target picker.");

  return await new Promise<SelectorPickResult>((resolve) => {
    let currentTarget: Element | undefined;

    const finish = (result: SelectorPickResult): void => {
      cleanup();
      resolve(result);
    };
    const cancel = (message: string): void => {
      finish({ actionId: action.id, selectors: action.selectors, error: message });
    };
    const onPointerMove = (event: MouseEvent): void => {
      const target = pickableTargetAtPoint(event, action.type);
      if (!target || isRecorderUI(target)) return;
      currentTarget = target;
      showPickerHighlight(target);
    };
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = pickableTargetAtPoint(event, action.type) ?? currentTarget;
      if (!target || isRecorderUI(target)) {
        cancel("No selectable page element was found under the pointer.");
        return;
      }

      const selectors = extractedSelectorsForTarget(target);
      const rankedCandidates = testSelectorCandidatesInDocument(buildSelectorCandidatesForElement(target), document, target);
      const recommended = rankedCandidates[0];
      const persistedCandidates = stripRuntimeScores(rankedCandidates);
      highlightElement(target);
      finish({
        actionId: action.id,
        selectors: recommended?.selector ?? selectors,
        selectorCandidates: persistedCandidates,
        selectedCandidateId: recommended?.id,
        frameSelector,
        preview: elementPreview(target),
        description: describePickedTarget(action, target, recommended?.selector ?? selectors),
        value: pickedValue(action, target)
      });
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel("Target picker cancelled.");
    };
    const cleanup = (): void => {
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      hidePickerInstruction();
      clearPickerHighlight();
      if (activeSelectorPick?.cancel === cancel) {
        activeSelectorPick = undefined;
      }
    };

    activeSelectorPick = { cancel };
    showPickerInstruction(action);
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.setTimeout(() => {
      if (activeSelectorPick?.cancel === cancel) {
        cancel("Target picker timed out.");
      }
    }, 30_000);
  });
}

export async function pickAnchor(action: RecordedAction): Promise<AnchorPickResult> {
  activeSelectorPick?.cancel("Replaced by a newer anchor picker.");

  return await new Promise<AnchorPickResult>((resolve) => {
    let currentTarget: Element | undefined;

    const finish = (result: AnchorPickResult): void => {
      cleanup();
      resolve(result);
    };
    const cancel = (message: string): void => {
      finish({ actionId: action.id, error: message });
    };
    const onPointerMove = (event: MouseEvent): void => {
      const target = semanticPickTarget(event.target as Element);
      if (!target || isRecorderUI(target)) return;
      currentTarget = target;
      showPickerHighlight(target);
    };
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = currentTarget ?? semanticPickTarget(event.target as Element);
      if (!target || isRecorderUI(target)) {
        cancel("No anchor text was selected.");
        return;
      }

      const anchor = computeAnchor(target) ?? anchorFromPickedElement(target);
      if (!anchor) {
        cancel("Pick stable text inside a row, dialog, form, or section.");
        return;
      }

      highlightElement(target);
      finish({
        actionId: action.id,
        anchor,
        preview: elementPreview(target)
      });
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel("Anchor picker cancelled.");
    };
    const cleanup = (): void => {
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      hidePickerInstruction();
      clearPickerHighlight();
      if (activeSelectorPick?.cancel === cancel) {
        activeSelectorPick = undefined;
      }
    };

    activeSelectorPick = { cancel };
    showPickerInstruction(action, "anchor");
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.setTimeout(() => {
      if (activeSelectorPick?.cancel === cancel) {
        cancel("Anchor picker timed out.");
      }
    }, 30_000);
  });
}

function pickableTargetAtPoint(event: MouseEvent, actionType: RecordedAction["type"]): Element | undefined {
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (isRecorderUI(element)) continue;
    const target = pickableTarget(element, actionType, { allowSemanticFallback: false });
    if (target) return target;
  }
  return pickableTarget(event.target as Element | null, actionType);
}

function pickableTarget(
  element: Element | null,
  actionType: RecordedAction["type"],
  options: { allowSemanticFallback?: boolean } = {}
): Element | undefined {
  if (!element) return undefined;
  const allowSemanticFallback = options.allowSemanticFallback !== false;
  if (actionType === "assert") {
    return assertionTarget(element) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  const checkbox = actionType === "click" ? checkboxTarget(element) : undefined;
  if (checkbox) return checkbox;

  if (actionType === "fill") {
    return element.closest("input, textarea, [contenteditable='true'], [role='textbox']") ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  if (actionType === "select") {
    return element.closest(
      "select, [role='combobox'], [role='option'], [class*='cpzui-select'], [class*='cpzui-virtual-filter-select']"
    ) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  if (actionType === "press") {
    return element.closest("input, textarea, button, a, [role='button'], [role='textbox'], [tabindex]") ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
  }
  return element.closest(
    `button, a, input[type='button'], input[type='submit'], ${CHECKBOX_TARGET_SELECTOR}, [role='button'], [role='link'], [aria-expanded], [class*='cpzui-button']`
  ) ?? (allowSemanticFallback ? semanticPickTarget(element) : undefined);
}

function checkboxTarget(element: Element): Element | undefined {
  const direct = element.closest(CHECKBOX_TARGET_SELECTOR);
  if (direct) return bestCheckboxTarget(direct);

  const row = element.closest('tr, [role="row"], li, [role="listitem"]');
  const rowCheckbox = row?.querySelector(CHECKBOX_TARGET_SELECTOR);
  return rowCheckbox ? bestCheckboxTarget(rowCheckbox) : undefined;
}

function assertionTarget(element: Element): Element | undefined {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    if (isMeaningfulAssertionTarget(current)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return undefined;
}

function isMeaningfulAssertionTarget(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (["html", "body", "main", "form", "table", "thead", "tbody", "tr"].includes(tag)) return false;
  if (!isElementVisible(element)) return false;

  const text = visibleText(element);
  if (text.length < 2 || text.length > 120) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;

  if (element.matches("a, button, td, th, span, strong, p, label, [role='link'], [role='button'], [role='gridcell'], [role='cell'], [data-testid]")) {
    return true;
  }

  return element.children.length === 0;
}

function semanticPickTarget(element: Element): Element {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 6) {
    if (
      current.matches("button, a, input, textarea, select, [role], [aria-label], [data-testid]") ||
      /cpzui-(button|select|virtual-filter-select|checkbox|tab)|zm-checkbox|zmu-checkbox|checkbox/i.test(String(current.className ?? "")) ||
      current.classList.contains("cpzui-form-item__label")
    ) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return element;
}

function anchorFromPickedElement(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const formFieldAnchor = formFieldAnchorFromPickedElement(element);
  if (formFieldAnchor) return formFieldAnchor;

  const container = element.closest('tr, [role="row"], li, [role="listitem"]');
  if (!container) return undefined;

  const scopeRole = container.tagName === "TR" || container.getAttribute("role") === "row" ? "row" : "listitem";
  const text = manualAnchorText(element, container);
  if (!text) return undefined;
  return { scopeRole, text, relationship: "within" };
}

function formFieldAnchorFromPickedElement(element: Element): NonNullable<SelectorStrategy["anchor"]> | undefined {
  const row = element.closest(".cpzui-form-item__row, [class*='form-item__row']");
  if (!row) return undefined;

  const text = formFieldLabelText(row);
  if (!text || text.length > 80) return undefined;

  return {
    text,
    scopeSelector: row.classList.contains("cpzui-form-item__row") ? ".cpzui-form-item__row" : "[class*='form-item__row']",
    relationship: "nearControl",
    kind: "formField"
  };
}

function formFieldLabelText(row: Element): string | undefined {
  const label = row.querySelector(".cpzui-form-item__label")
    ?? row.querySelector("[class*='form-item__label']:not([class*='wrapper']):not([class*='content'])")
    ?? row.querySelector("label")
    ?? row.querySelector("[aria-label]");
  return label?.textContent?.replace(/\s+/g, " ").trim();
}

function manualAnchorText(element: Element, container: Element): string | undefined {
  const ownText = visibleText(element);
  if (ownText.length > 1 && ownText.length <= 80) return ownText;

  const candidates = Array.from(container.querySelectorAll("td, th, [role='gridcell'], [role='cell'], span, strong, a"))
    .map((candidate) => visibleText(candidate))
    .filter((text) => text.length > 1 && text.length <= 80);
  const email = candidates.find((text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text));
  return email ?? candidates[0];
}

function extractedSelectorsForTarget(target: Element): SelectorStrategy {
  let selectors = extractSelectors(target);
  const nth = computeNth(target, selectors);
  if (nth !== undefined) {
    selectors = { ...selectors, nth };
  }
  const anchor = computeAnchor(target);
  if (anchor) {
    selectors = { ...selectors, anchor };
  }
  return selectors;
}

function describePickedTarget(action: RecordedAction, target: Element, selectors: SelectorStrategy): string {
  const label = selectors.role?.name ?? selectors.label ?? selectors.text ?? elementPreview(target);
  if (action.type === "assert") return `Assert text visible: ${assertionText(target) ?? label}`;
  if (action.type === "fill") return `Fill "${label}"`;
  if (action.type === "select") return `Select option in "${label}"`;
  if (action.type === "press") return `Press ${action.key ?? "Enter"}${label ? ` in "${label}"` : ""}`;
  return `Click "${label}"`;
}

function pickedValue(action: RecordedAction, target: Element): string | undefined {
  if (action.type === "assert") return assertionText(target);
  if (action.type !== "select") return undefined;
  if (target instanceof HTMLOptionElement) return target.text.trim() || target.value;
  if (target.getAttribute("role") === "option") return visibleText(target);
  return undefined;
}

function assertionText(target: Element): string | undefined {
  const text = visibleText(target).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 120 ? text.slice(0, 120).trim() : text;
}

function showPickerInstruction(action: RecordedAction, mode: "target" | "anchor" = "target"): void {
  const existing = document.getElementById("__zoom_recorder_picker_instruction");
  if (existing) existing.remove();
  const instruction = document.createElement("div");
  instruction.id = "__zoom_recorder_picker_instruction";
  instruction.textContent = mode === "anchor"
    ? "Click stable label, row, dialog, or section text to add context. Press Esc to cancel."
    : `Click the ${pickerNoun(action.type)} to use for this step. Press Esc to cancel.`;
  instruction.style.cssText = [
    "position: fixed",
    "top: 8px",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 999999",
    "background: #0b5cff",
    "color: white",
    "padding: 7px 14px",
    "border-radius: 18px",
    "font-family: system-ui, sans-serif",
    "font-size: 12px",
    "font-weight: 700",
    "box-shadow: 0 2px 10px rgba(0,0,0,0.24)",
    "pointer-events: none"
  ].join(";");
  document.body.appendChild(instruction);
}

function pickerNoun(actionType: RecordedAction["type"]): string {
  if (actionType === "assert") return "text or element to validate";
  if (actionType === "fill") return "field";
  if (actionType === "select") return "dropdown or option";
  if (actionType === "press") return "field or control";
  return "button or link";
}

function hidePickerInstruction(): void {
  document.getElementById("__zoom_recorder_picker_instruction")?.remove();
}

function showPickerHighlight(element: Element): void {
  const id = "__zoom_recorder_picker_highlight";
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText = [
      "position: fixed",
      "border: 3px solid #0b5cff",
      "box-shadow: 0 0 0 3px rgba(11,92,255,0.22)",
      "border-radius: 6px",
      "z-index: 999998",
      "pointer-events: none"
    ].join(";");
    document.body.appendChild(overlay);
  }
  const rect = element.getBoundingClientRect();
  overlay.style.left = `${Math.max(rect.left - 3, 0)}px`;
  overlay.style.top = `${Math.max(rect.top - 3, 0)}px`;
  overlay.style.width = `${Math.max(rect.width + 6, 6)}px`;
  overlay.style.height = `${Math.max(rect.height + 6, 6)}px`;
}

function clearPickerHighlight(): void {
  document.getElementById("__zoom_recorder_picker_highlight")?.remove();
}
