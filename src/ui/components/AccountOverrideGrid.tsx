import type { WorkflowParameter } from "@zoom-automation/workflow-core";
import { parameterLabel } from "../workflowParameters.js";

interface AccountOverrideGridProps {
  parameters: WorkflowParameter[];
  summary?: string;
  error?: string;
  onFile(file: File): void;
  onClear(): void;
}

export function AccountOverrideGrid({ parameters, summary, error, onFile, onClear }: AccountOverrideGridProps) {
  const overrideParameters = parameters.filter((parameter) => parameter.ui?.accountOverrideAllowed);
  if (overrideParameters.length === 0) return null;

  return (
    <section className="configure-section account-overrides">
      <h3>Account Overrides</h3>
      <p className="configure-hint">Upload account-specific values for parameters that vary by sub account.</p>
      <div className="override-columns">
        <div>
          <span className="field-label">CSV columns</span>
          <div className="override-chip-list">
            <span className="override-chip">accountId</span>
            {overrideParameters.map((parameter) => (
              <span key={parameter.name} className="override-chip" title={parameter.name}>
                {parameterLabel(parameter)}
              </span>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Override file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          {summary ? (
            <small className="csv-summary">
              Loaded: {summary} <button className="tertiary-button" onClick={onClear}>Clear</button>
            </small>
          ) : null}
          {error ? <small className="import-error">{error}</small> : null}
        </label>
      </div>
    </section>
  );
}
