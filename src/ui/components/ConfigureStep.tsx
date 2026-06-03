import { useState } from "react";
import type { AddressProfileView, WorkflowView } from "../api.js";
import { CheckIcon, ChevronRightIcon } from "./Icons.js";

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
}

export function ConfigureStep({
  workflows, selectedWorkflowIds, pipelineOrder, profiles, selectedProfileId,
  dryRun, headless, concurrency, retryAttempts, accountCount,
  onToggleWorkflow, onReorderPipeline, onProfileChange,
  onDryRunChange, onHeadlessChange, onConcurrencyChange, onRetryAttemptsChange,
  onImportWorkflow, onBack, onNext
}: ConfigureStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const canProceed = pipelineOrder.length > 0 && selectedProfileId;

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
        </section>
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
