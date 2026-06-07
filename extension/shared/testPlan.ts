import type { RecordedAction } from "@zoom-automation/workflow-core";

export type StepTestMode = "full" | "single" | "from";

export interface StepTestPlanOptions {
  mode: StepTestMode;
  actionId?: string;
}

export interface StepTestPlan {
  mode: StepTestMode;
  actions: RecordedAction[];
}

export function createStepTestPlan(actions: RecordedAction[], options: StepTestPlanOptions): StepTestPlan {
  if (options.mode === "full") return { mode: options.mode, actions: [...actions] };
  const index = actions.findIndex((action) => action.id === options.actionId);
  if (index < 0) return { mode: options.mode, actions: [] };
  if (options.mode === "single") return { mode: options.mode, actions: [actions[index]] };
  return { mode: options.mode, actions: actions.slice(index) };
}
