import { useState } from "react";
import type { AddressProfileView, RunReadinessView, WorkflowView } from "../api.js";
import { CheckIcon, ChevronRightIcon } from "./Icons.js";
import { RunReadinessPanel } from "./RunReadinessPanel.js";

interface ConfigureStepProps {
  workflows: WorkflowView[];
  selectedWorkflowIds: Set<string>;
  pipelineOrder: string[];
  profiles: AddressProfileView[];
  selectedProfileId: string;
  dryRun: boolean;
  headless: boolean;
  concurrency: number;
  retryAttempts: number;
  accountCount: number;
  readiness?: RunReadinessView;
  readinessLoading?: boolean;
  readinessError?: string;
  onToggleWorkflow(id: string): void;
  onReorderPipeline(order: string[]): void;
  onProfileChange(id: string): void;
  onDryRunChange(value: boolean): void;
  onHeadlessChange(value: boolean): void;
  onConcurrencyChange(value: number): void;
  onRetryAttemptsChange(value: number): void;
  onImportWorkflow(): void;
  onBack(): void;
  onNext(): void;
  /** Per-account values parsed from a CSV (keyed by account id → param → value). */
  onAccountValuesChange?(values: Record<string, Record<string, string>> | undefined): void;
}

export function ConfigureStep({
  workflows, selectedWorkflowIds, pipelineOrder, profiles, selectedProfileId,
  dryRun, headless, concurrency, retryAttempts, accountCount,
  readiness, readinessLoading, readinessError,
  onToggleWorkflow, onReorderPipeline, onProfileChange,
  onDryRunChange, onHeadlessChange, onConcurrencyChange, onRetryAttemptsChange,
  onImportWorkflow, onBack, onNext, onAccountValuesChange
}: ConfigureStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [csvSummary, setCsvSummary] = useState<string | undefined>();
  const [csvError, setCsvError] = useState<string | undefined>();
  const canProceed = pipelineOrder.length > 0 && selectedProfileId && readiness?.ready !== false;

  const handleCsv = async (file: File) => {
    setCsvError(undefined);
    try {
      const { values, accounts, params } = parseAccountValuesCsv(await file.text());
      onAccountValuesChange?.(values);
      setCsvSummary(`${accounts} account(s) · ${params.join(", ")}`);
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : String(error));
      onAccountValuesChange?.(undefined);
      setCsvSummary(undefined);
    }
  };

  const clearCsv = () => {
    onAccountValuesChange?.(undefined);
    setCsvSummary(undefined);
    setCsvError(undefined);
  };

  const moveUp = (id: string) => {
    const idx = pipelineOrder.indexOf(id);
    if (idx <= 0) return;
    const next = [...pipelineOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onReorderPipeline(next);
  };

  const moveDown = (id: string) => {
    const idx = pipelineOrder.indexOf(id);
    if (idx < 0 || idx >= pipelineOrder.length - 1) return;
    const next = [...pipelineOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onReorderPipeline(next);
  };

  const profile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="configure-step">
      <div className="configure-grid">
        {/* Workflows */}
        <section className="configure-section">
          <div className="configure-section-header">
            <h3>Select Workflows</h3>
            <button className="tertiary-button" onClick={onImportWorkflow}>+ Import recorded</button>
          </div>
          <p className="configure-hint">Choose one or more workflows to run on {accountCount} account{accountCount !== 1 ? "s" : ""}.</p>

          {pipelineOrder.length > 0 ? (
            <div className="pipeline-preview">
              <span className="pipeline-preview-label">Run order:</span>
              {pipelineOrder.map((id, index) => {
                const wf = workflows.find((w) => w.id === id);
                return (
                  <span key={id} className="pipeline-chip">
                    <span className="pipeline-chip-num">{index + 1}</span>
                    {wf?.name ?? id}
                    {pipelineOrder.length > 1 ? (
                      <>
                        <button className="pipeline-chip-btn" onClick={() => moveUp(id)} disabled={index === 0}>↑</button>
                        <button className="pipeline-chip-btn" onClick={() => moveDown(id)} disabled={index === pipelineOrder.length - 1}>↓</button>
                      </>
                    ) : null}
                    <button className="pipeline-chip-btn" onClick={() => onToggleWorkflow(id)}>×</button>
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="workflow-grid">
            {workflows.map((workflow) => {
              const selected = selectedWorkflowIds.has(workflow.id);
              return (
                <button
                  key={workflow.id}
                  className={`workflow-card ${selected ? "selected" : ""}`}
                  disabled={!workflow.enabled}
                  onClick={() => onToggleWorkflow(workflow.id)}
                >
                  <span className="workflow-card-check">{selected ? <CheckIcon /> : <ChevronRightIcon />}</span>
                  <span className="workflow-card-content">
                    <strong>{workflow.name}</strong>
                    <small>{workflow.description}</small>
                  </span>
                  <span className={`status-badge ${workflow.enabled ? "success" : "neutral"}`}>
                    {workflow.enabled ? "Available" : "Coming soon"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Address Profile */}
        <section className="configure-section">
          <h3>Address Profile</h3>
          <p className="configure-hint">Select the address profile that provides parameterized values (country, city, documents).</p>

          <div className="profile-selector">
            <select value={selectedProfileId} onChange={(e) => onProfileChange(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.id} — {p.country} ({p.numberType})</option>
              ))}
            </select>
          </div>

          {profile ? (
            <div className="profile-detail-grid">
              <div className="profile-detail-item">
                <span>Country</span>
                <strong>{profile.country}</strong>
              </div>
              <div className="profile-detail-item">
                <span>Number type</span>
                <strong>{profile.numberType}</strong>
              </div>
              <div className="profile-detail-item">
                <span>Customer</span>
                <strong>{profile.customerName}</strong>
              </div>
              <div className="profile-detail-item">
                <span>Address</span>
                <strong>{[profile.address.line1, profile.address.city, profile.address.postalCode].filter(Boolean).join(", ")}</strong>
              </div>
              <div className="profile-detail-item">
                <span>Documents</span>
                <strong>{profile.documentsRequired ? "Required ✓" : "Not required"}</strong>
              </div>
            </div>
          ) : null}
        </section>

        {/* Run Settings */}
        <section className="configure-section">
          <h3>Run Settings</h3>
          <div className="settings-row">
            <label className="toggle-label">
              <input type="checkbox" checked={dryRun} onChange={(e) => onDryRunChange(e.target.checked)} />
              <span>Dry run</span>
              <small>Simulate without making changes</small>
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={headless} onChange={(e) => onHeadlessChange(e.target.checked)} />
              <span>Headless</span>
              <small>Run browser in background</small>
            </label>
          </div>

          <button className="tertiary-button" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "Hide advanced ▴" : "Show advanced ▾"}
          </button>

          {showAdvanced ? (
            <div className="advanced-grid">
              <label className="field">
                <span>Concurrency</span>
                <input type="range" min="1" max="10" value={concurrency} onChange={(e) => onConcurrencyChange(Number(e.target.value))} />
                <small>{concurrency} account{concurrency > 1 ? "s" : ""} in parallel</small>
              </label>
              <label className="field">
                <span>Retry attempts</span>
                <input type="range" min="1" max="5" value={retryAttempts} onChange={(e) => onRetryAttemptsChange(Number(e.target.value))} />
                <small>{retryAttempts} attempt{retryAttempts > 1 ? "s" : ""} per account</small>
              </label>
            </div>
          ) : null}

          {/* Per-account values (optional) */}
          <div className="field" style={{ marginTop: 12 }}>
            <span>Per-account values (CSV)</span>
            <small>First column = sub-account id; other columns = parameter names (e.g. <code>contact.email</code>). Overrides the profile per account.</small>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCsv(f); e.target.value = ""; }} />
            {csvSummary ? (
              <small className="csv-summary">Loaded: {csvSummary} <button className="tertiary-button" onClick={clearCsv}>Clear</button></small>
            ) : null}
            {csvError ? <small className="import-error">{csvError}</small> : null}
          </div>
        </section>

        <RunReadinessPanel readiness={readiness} loading={readinessLoading} error={readinessError} />
      </div>

      {/* Footer */}
      <div className="wizard-footer">
        <button className="tertiary-button" onClick={onBack}>← Back to accounts</button>
        <div className="wizard-footer-right">
          <span className="wizard-footer-summary">
            {accountCount} account{accountCount !== 1 ? "s" : ""} × {pipelineOrder.length} workflow{pipelineOrder.length !== 1 ? "s" : ""}
            {dryRun ? " (dry run)" : ""}
          </span>
          <button className="primary-button" onClick={onNext} disabled={!canProceed}>
            {dryRun ? "Start dry run →" : "Start run →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Parse a per-account values CSV. The first column is the sub-account id; each
 * other column header is a parameter name. Returns a map keyed by account id.
 */
function parseAccountValuesCsv(text: string): {
  values: Record<string, Record<string, string>>;
  accounts: number;
  params: string[];
} {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(splitCsvLine);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one account row");
  const header = rows[0];
  const params = header.slice(1).map((h) => h.trim()).filter(Boolean);
  if (params.length === 0) throw new Error("CSV needs at least one parameter column after the account id");

  const values: Record<string, Record<string, string>> = {};
  for (const row of rows.slice(1)) {
    const accountId = row[0]?.trim();
    if (!accountId) continue;
    const entry: Record<string, string> = {};
    params.forEach((param, i) => {
      const cell = row[i + 1];
      if (cell !== undefined && cell !== "") entry[param] = cell;
    });
    values[accountId] = entry;
  }
  return { values, accounts: Object.keys(values).length, params };
}

/** Minimal CSV line splitter with double-quote support. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
