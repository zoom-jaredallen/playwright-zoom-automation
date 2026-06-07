import type { ReactElement } from "react";
import type { WorkflowParameter } from "@zoom-automation/workflow-core";
import { groupWorkflowParametersForUi, parameterLabel, parameterPlaceholder } from "../workflowParameters.js";

interface WorkflowParameterFormProps {
  parameters: WorkflowParameter[];
  values: Record<string, string>;
  onChange(values: Record<string, string>): void;
}

export function WorkflowParameterForm({ parameters, values, onChange }: WorkflowParameterFormProps) {
  if (parameters.length === 0) return null;
  const groups = groupWorkflowParametersForUi(parameters);

  const update = (name: string, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <section className="configure-section workflow-parameter-form">
      <h3>Workflow Parameters</h3>
      <p className="configure-hint">Provide reusable values required by the selected recorded workflows.</p>
      {groups.map((group) => (
        <div key={group.name} className="parameter-group">
          <div className="parameter-group-header">
            <strong>{group.name}</strong>
            <small>{group.parameters.length} value{group.parameters.length === 1 ? "" : "s"}</small>
          </div>
          <div className="parameter-form-grid">
            {group.parameters.map((parameter) => (
              <label key={parameter.name} className="field">
                <span>{parameterLabel(parameter)}{parameter.required ? " *" : ""}</span>
                {renderParameterInput(parameter, values[parameter.name] ?? parameter.defaultValue ?? "", update)}
                <small>{parameter.ui?.helpText ?? parameter.description}</small>
                {parameter.ui?.accountOverrideAllowed ? <small className="parameter-override-hint">Can be overridden per account by CSV.</small> : null}
              </label>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function renderParameterInput(
  parameter: WorkflowParameter,
  value: string,
  update: (name: string, value: string) => void
): ReactElement {
  if (parameter.type === "select" && parameter.options?.length) {
    return (
      <select value={value} onChange={(event) => update(parameter.name, event.target.value)}>
        <option value="">Select…</option>
        {parameter.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (parameter.type === "file") {
    return (
      <input
        type="file"
        accept={parameter.ui?.fileAccept}
        onChange={(event) => update(parameter.name, event.target.files?.[0]?.name ?? "")}
      />
    );
  }
  return (
    <input
      type={parameter.type === "number" ? "number" : parameter.ui?.secret ? "password" : "text"}
      value={value}
      placeholder={parameterPlaceholder(parameter)}
      onChange={(event) => update(parameter.name, event.target.value)}
    />
  );
}
