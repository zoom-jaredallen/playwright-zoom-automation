import { useState } from "react";
import type { JobView, SubAccountView } from "../api.js";
import { PlayIcon } from "./Icons.js";

interface RunMonitorProps {
  selectedCount: number;
  job?: JobView;
  accountsById: Map<string, SubAccountView>;
  dryRun: boolean;
  headless: boolean;
  concurrency: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  accountDelayMs: number;
  running: boolean;
  onDryRunChange(value: boolean): void;
  onHeadlessChange(value: boolean): void;
  onConcurrencyChange(value: number): void;
  onRetryAttemptsChange(value: number): void;
  onRetryBaseDelayMsChange(value: number): void;
  onAccountDelayMsChange(value: number): void;
  onStart(): void;
  onCancel?(): void;
}

export function RunMonitor({
  selectedCount,
  job,
  accountsById,
  dryRun,
  headless,
  concurrency,
  retryAttempts,
  retryBaseDelayMs,
  accountDelayMs,
  running,
  onDryRunChange,
  onHeadlessChange,
  onConcurrencyChange,
  onRetryAttemptsChange,
  onRetryBaseDelayMsChange,
  onAccountDelayMsChange,
  onStart,
  onCancel
}: RunMonitorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleExportCsv = () => {
    if (!job) return;
    const rows = [["Account Name", "Owner Email", "Account ID", "Status", "Message", "Error"].join(",")];
    for (const accountState of job.accounts) {
      const account = accountsById.get(accountState.accountId);
      rows.push([
        csvEscape(account?.name ?? accountState.accountId),
        csvEscape(account?.ownerEmail ?? ""),
        csvEscape(accountState.accountId),
        accountState.status,
        csvEscape(accountState.message ?? ""),
        csvEscape(accountState.error ?? "")
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${job.id.slice(0, 8)}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel run-panel" id="run">
      <div className="panel-header">
        <div>
          <h2>Run monitor</h2>
          <p>Configure parameters, start a batch, and watch progress in real time.</p>
        </div>
        <div className="panel-header-actions">
          {job && !running ? (
            <button className="tertiary-button" onClick={handleExportCsv}>
              Export CSV
            </button>
          ) : null}
          {running && onCancel ? (
            <button className="danger-button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button className="primary-button" onClick={onStart} disabled={selectedCount === 0 || running}>
            <PlayIcon />
            {running ? "Running" : "Start run"}
          </button>
        </div>
      </div>

      <div className="run-controls">
        <label className="toggle-row">
          <input type="checkbox" checked={dryRun} onChange={(event) => onDryRunChange(event.target.checked)} />
          <span>Dry run</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={headless} onChange={(event) => onHeadlessChange(event.target.checked)} />
          <span>Headless</span>
        </label>
        <div className="selected-count">{selectedCount} selected</div>
        <button
          className="tertiary-button advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Hide" : "Advanced"} ▾
        </button>
      </div>

      {showAdvanced ? (
        <div className="advanced-controls">
          <label className="field-inline">
            <span>Concurrency</span>
            <input
              type="range"
              min="1"
              max="10"
              value={concurrency}
              onChange={(e) => onConcurrencyChange(Number(e.target.value))}
            />
            <strong>{concurrency}</strong>
          </label>
          <label className="field-inline">
            <span>Retries</span>
            <input
              type="range"
              min="1"
              max="5"
              value={retryAttempts}
              onChange={(e) => onRetryAttemptsChange(Number(e.target.value))}
            />
            <strong>{retryAttempts}</strong>
          </label>
          <label className="field-inline">
            <span>Retry delay</span>
            <select value={retryBaseDelayMs} onChange={(e) => onRetryBaseDelayMsChange(Number(e.target.value))}>
              <option value="1000">1s</option>
              <option value="2000">2s</option>
              <option value="5000">5s</option>
              <option value="10000">10s</option>
              <option value="30000">30s</option>
            </select>
          </label>
          <label className="field-inline">
            <span>Account delay</span>
            <select value={accountDelayMs} onChange={(e) => onAccountDelayMsChange(Number(e.target.value))}>
              <option value="0">None</option>
              <option value="1000">1s</option>
              <option value="2000">2s</option>
              <option value="5000">5s</option>
              <option value="10000">10s</option>
            </select>
          </label>
        </div>
      ) : null}

      <div className="summary-grid">
        {(["queued", "running", "completed", "skipped", "failed"] as const).map((key) => (
          <div key={key} className="summary-tile">
            <span>{labelForStatus(key)}</span>
            <strong>{job?.summary[key] ?? 0}</strong>
          </div>
        ))}
      </div>

      <div className="run-list">
        {!job ? (
          <div className="empty-run">No run started yet. Select accounts and click Start run.</div>
        ) : (
          job.accounts.map((accountState) => {
            const account = accountsById.get(accountState.accountId);
            return (
              <div key={accountState.accountId} className={`run-row ${rowClass(accountState.status)}`}>
                <div>
                  <strong>{account?.name ?? accountState.accountId}</strong>
                  <small>{account?.ownerEmail ?? accountState.accountId}</small>
                  {accountState.message ? <small className="run-message">{accountState.message}</small> : null}
                  {accountState.error ? <small className="run-error">{accountState.error}</small> : null}
                </div>
                <span className={`status-badge ${statusClass(accountState.status)}`}>
                  {labelForStatus(accountState.status)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {job?.status === "cancelled" ? (
        <div className="banner warning">Run was cancelled. Accounts already in progress finished normally.</div>
      ) : null}
    </section>
  );
}

function labelForStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: string): string {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "primary";
  if (status === "cancelled") return "warning";
  return "neutral";
}

function rowClass(status: string): string {
  if (status === "completed") return "run-row-success";
  if (status === "failed") return "run-row-error";
  if (status === "running") return "run-row-active";
  return "";
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
