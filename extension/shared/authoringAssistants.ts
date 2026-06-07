import { detectParameters } from "@zoom-automation/workflow-core";
import type { RecordedAction, StepCondition } from "@zoom-automation/workflow-core";

export interface ParameterReplacementSuggestion {
  actionId: string;
  field: "value" | "expected";
  originalValue: string;
  suggestedName: string;
  replacement: string;
}

export type ConditionPreset =
  | "text-exists-skip"
  | "element-visible-click"
  | "field-empty-fill"
  | "address-exists-skip-account";

export function suggestParameterReplacements(actions: RecordedAction[]): ParameterReplacementSuggestion[] {
  const suggestions: ParameterReplacementSuggestion[] = [];
  for (const action of actions) {
    for (const field of ["value", "expected"] as const) {
      const originalValue = action[field];
      if (!originalValue || originalValue.includes("{{")) continue;
      const detected = detectParameters(originalValue, { label: action.description ?? action.selectors.label });
      const first = detected[0];
      if (!first) continue;
      const suggestedName = normalizeSuggestedName(first.suggestedName);
      suggestions.push({
        actionId: action.id,
        field,
        originalValue,
        suggestedName,
        replacement: `{{${suggestedName}}}`
      });
    }
  }
  return suggestions;
}

export function buildConditionPreset(preset: ConditionPreset, input: { text?: string }): StepCondition {
  if (preset === "text-exists-skip") return { type: "textExistsSkip", text: input.text };
  if (preset === "element-visible-click") return { type: "elementVisibleClick", text: input.text };
  if (preset === "field-empty-fill") return { type: "fieldEmptyFill", text: input.text };
  return { type: "addressAlreadyExistsSkipAccount", text: input.text };
}

function normalizeSuggestedName(name: string): string {
  if (name === "contactEmail") return "contact.email";
  if (name === "contactNumber") return "contact.number";
  return name;
}
