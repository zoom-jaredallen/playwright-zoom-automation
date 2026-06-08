export function findSemanticParent(element: Element): Element | undefined {
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 6) {
    if (isSemanticElement(current)) {
      return current;
    }
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
  if (/cpzui-button(?!__)/.test(classes)) return true;
  if (/cpzui-select(?!-)/.test(classes) || /cpzui-virtual-filter-select(?!-)/.test(classes)) return true;
  if (/cpzui-checkbox(?!__)|zm-checkbox|zmu-checkbox|checkbox/i.test(String(classes))) return true;
  if (/cpzui-tab(?!__)/.test(classes)) return true;
  return false;
}
