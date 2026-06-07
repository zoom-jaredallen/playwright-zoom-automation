import type { WorkflowParameter } from "@zoom-automation/workflow-core";

export interface WorkflowParameterGroupView {
  name: string;
  parameters: WorkflowParameter[];
}

const GROUP_ORDER = ["Business identity", "Address", "Documents", "Account overrides", "Other"];

export function groupWorkflowParametersForUi(parameters: WorkflowParameter[]): WorkflowParameterGroupView[] {
  const groups = new Map<string, WorkflowParameter[]>();
  for (const parameter of parameters) {
    const group = parameter.ui?.group ?? fallbackGroup(parameter);
    groups.set(group, [...(groups.get(group) ?? []), parameter]);
  }
  return [...groups.entries()]
    .map(([name, grouped]) => ({
      name,
      parameters: grouped.sort((a, b) => (a.ui?.label ?? a.name).localeCompare(b.ui?.label ?? b.name))
    }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name));
}

export function parameterLabel(parameter: WorkflowParameter): string {
  return parameter.ui?.label ?? humanize(parameter.name);
}

export function parameterPlaceholder(parameter: WorkflowParameter): string {
  return parameter.ui?.placeholder ?? parameter.description;
}

function fallbackGroup(parameter: WorkflowParameter): string {
  if (/company|customer|status/i.test(parameter.name)) return "Business identity";
  if (parameter.type === "file" || /document|verification|file|Path$/i.test(parameter.name)) return "Documents";
  if (parameter.name.startsWith("address.") || /country|city|state|postal|numberType|line1|line2/i.test(parameter.name)) return "Address";
  return parameter.source === "account" ? "Account overrides" : "Other";
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
