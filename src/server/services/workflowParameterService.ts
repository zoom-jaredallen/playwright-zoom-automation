import type { RecordedWorkflow, WorkflowParameter } from "@zoom-automation/workflow-core";

export interface WorkflowParameterValidationError {
  name: string;
  message: string;
}

export interface WorkflowParameterValidationResult {
  valid: boolean;
  errors: WorkflowParameterValidationError[];
}

export interface WorkflowParameterGroup {
  name: string;
  parameters: WorkflowParameter[];
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
      byName.set(parameter.name, normalizeWorkflowParameterForUi(existing ? { ...existing, required: existing.required || parameter.required } : parameter));
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeWorkflowParameterForUi(parameter: WorkflowParameter): WorkflowParameter {
  const inferred = inferUiHint(parameter);
  return {
    ...parameter,
    ui: {
      ...inferred,
      ...parameter.ui
    }
  };
}

export function groupWorkflowParameters(parameters: WorkflowParameter[]): WorkflowParameterGroup[] {
  const order = ["Business identity", "Address", "Documents", "Account overrides", "Other"];
  const groups = new Map<string, WorkflowParameter[]>();
  for (const parameter of parameters.map(normalizeWorkflowParameterForUi)) {
    const group = parameter.ui?.group ?? "Other";
    groups.set(group, [...(groups.get(group) ?? []), parameter]);
  }
  return [...groups.entries()]
    .map(([name, groupedParameters]) => ({
      name,
      parameters: groupedParameters.sort((a, b) => parameterSortKey(a).localeCompare(parameterSortKey(b)))
    }))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

function inferUiHint(parameter: WorkflowParameter): NonNullable<WorkflowParameter["ui"]> {
  const name = parameter.name;
  if (/company|customerName/i.test(name)) {
    return {
      group: "Business identity",
      label: humanize(name),
      placeholder: "Zoom Communications Ltd",
      accountOverrideAllowed: true
    };
  }
  if (/status/i.test(name)) {
    return {
      group: "Business identity",
      label: humanize(name),
      placeholder: "Verified",
      accountOverrideAllowed: false
    };
  }
  if (/document|verification|file|Path$/i.test(name) || parameter.type === "file") {
    return {
      group: "Documents",
      label: humanize(name),
      fileAccept: ".pdf,.png,.jpg,.jpeg",
      accountOverrideAllowed: true
    };
  }
  if (name.startsWith("address.") || /country|city|state|postal|numberType|line1|line2/i.test(name)) {
    return {
      group: "Address",
      label: humanize(name.replace(/^address\./, "")),
      accountOverrideAllowed: true
    };
  }
  return {
    group: parameter.source === "account" ? "Account overrides" : "Other",
    label: humanize(name),
    accountOverrideAllowed: parameter.source === "account"
  };
}

function parameterSortKey(parameter: WorkflowParameter): string {
  const order = ["company", "customer", "expected", "country", "number", "line1", "line2", "city", "state", "postal", "document", "verification"];
  const name = parameter.name.toLowerCase();
  const index = order.findIndex((token) => name.includes(token));
  return `${index < 0 ? 99 : index}-${parameter.ui?.label ?? parameter.name}`;
}

function humanize(name: string): string {
  const text = name
    .replace(/^address\./, "")
    .replace(/Path$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
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
