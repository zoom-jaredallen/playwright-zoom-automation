import type { WorkflowParameter } from "@zoom-automation/workflow-core";

interface WorkflowParameterFormProps {
  parameters: WorkflowParameter[];
  values: Record<string, string>;
  onChange(values: Record<string, string>): void;
}

export function WorkflowParameterForm({ parameters, values, onChange }: WorkflowParameterFormProps) {
  if (parameters.length === 0) return null;

  const update = (name: string, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <section className="configure-section workflow-parameter-form">
      <h3>Workflow Parameters</h3>
      <p className="configure-hint">Provide reusable values required by the selected recorded workflows.</p>
      <div className="parameter-form-grid">
        {parameters.map((parameter) => (
          <label key={parameter.name} className="field">
            <span>{parameter.name}{parameter.required ? " *" : ""}</span>
            {parameter.type === "select" && parameter.options?.length ? (
              <select value={values[parameter.name] ?? parameter.defaultValue ?? ""} onChange={(event) => update(parameter.name, event.target.value)}>
                <option value="">Select…</option>
                {parameter.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                type={parameter.type === "number" ? "number" : "text"}
                value={values[parameter.name] ?? parameter.defaultValue ?? ""}
                placeholder={parameter.description}
                onChange={(event) => update(parameter.name, event.target.value)}
              />
            )}
            <small>{parameter.description}</small>
          </label>
        ))}
      </div>
    </section>
  );
}
