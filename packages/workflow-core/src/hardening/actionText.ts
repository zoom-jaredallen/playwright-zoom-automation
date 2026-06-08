import type { RecordedAction } from "../types.js";

export function flattenActionTree(actions: RecordedAction[]): RecordedAction[] {
  const flat: RecordedAction[] = [];
  for (const action of actions) {
    flat.push(action);
    if (action.type === "if") {
      if (action.thenActions) flat.push(...flattenActionTree(action.thenActions));
      if (action.elseActions) flat.push(...flattenActionTree(action.elseActions));
    }
  }
  return flat;
}

export function actionLabel(action: RecordedAction): string {
  return firstNonEmpty(
    action.selectors.role?.name,
    action.selectors.label,
    action.selectors.text,
    action.selectors.anchor?.text,
    action.description
  );
}

export function actionSearchText(action: RecordedAction): string {
  return [
    action.type,
    action.description,
    action.selectors.role?.role,
    action.selectors.role?.name,
    action.selectors.label,
    action.selectors.text,
    action.selectors.anchor?.text,
    action.value,
    action.expected,
    action.pageUrl,
    action.pageTitle,
    action.networkWaitUrl
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function normalizedFieldLabel(action: RecordedAction): string {
  return firstNonEmpty(
    action.selectors.label,
    action.selectors.role?.name,
    action.selectors.anchor?.text,
    action.description?.replace(/^(fill|select|click)\s+/i, "").replace(/\s+with\s+".*"$/i, "")
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}
