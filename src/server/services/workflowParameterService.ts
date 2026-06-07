import type { RecordedWorkflow, WorkflowParameter } from "@zoom-automation/workflow-core";

export interface WorkflowParameterValidationError {
  name: string;
  message: string;
}

export interface WorkflowParameterValidationResult {
  valid: boolean;
  errors: WorkflowParameterValidationError[];
}

export function buildWorkflowParameterDefaults(workflow: Pick<RecordedWorkflow, "parameters">): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of workflow.parameters ?? []) {
    if (parameter.defaultValue !== undefined) values[parameter.name] = String(parameter.defaultValue);
  }
  return values;
}

export function validateWorkflowParameterValues(
  workflow: Pick<RecordedWorkflow, "parameters">,
  values: Record<string, string | undefined>
): WorkflowParameterValidationResult {
  const errors: WorkflowParameterValidationError[] = [];
  for (const parameter of workflow.parameters ?? []) {
    const value = values[parameter.name];
    if (parameter.required && !hasValue(value)) {
      errors.push({ name: parameter.name, message: `${parameter.name} is required` });
      continue;
    }
    if (hasValue(value)) validateValue(parameter, value, errors);
  }
  return { valid: errors.length === 0, errors };
}

export function collectWorkflowParameters(workflows: Array<{ parameters?: WorkflowParameter[] }>): WorkflowParameter[] {
  const byName = new Map<string, WorkflowParameter>();
  for (const workflow of workflows) {
    for (const parameter of workflow.parameters ?? []) {
      const existing = byName.get(parameter.name);
      byName.set(parameter.name, existing ? { ...existing, required: existing.required || parameter.required } : parameter);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function validateValue(parameter: WorkflowParameter, value: string, errors: WorkflowParameterValidationError[]): void {
  if (parameter.type === "select" && parameter.options?.length && !parameter.options.includes(value)) {
    errors.push({ name: parameter.name, message: `${parameter.name} must be one of: ${parameter.options.join(", ")}` });
  }
  if (parameter.type === "number" && Number.isNaN(Number(value))) {
    errors.push({ name: parameter.name, message: `${parameter.name} must be a number` });
  }
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
