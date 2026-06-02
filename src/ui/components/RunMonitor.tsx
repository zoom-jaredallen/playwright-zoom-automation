import type { JobView, SubAccountView } from "../api.js";
import { PlayIcon } from "./Icons.js";

interface RunMonitorProps {
  selectedCount: number;
  job?: JobView;
  accountsById: Map<string, SubAccountView>;
  dryRun: boolean;
  headless: boolean;
  running: boolean;
  onDryRunChange(value: boolean): void;
  onHeadlessChange(value: boolean): void;
  onStart(): void;
}

export function RunMonitor({
  selectedCount,
  job,
  accountsById,
  dryRun,
  headless,
  running,
  onDryRunChange,
  onHeadlessChange,
  onStart
}: RunMonitorProps) {
  return (
    <section className="panel run-panel" id="run">
      <div className="panel-header">
        <div>
          <h2>Run monitor</h2>
          <p>Start a batch and watch account-level progress in memory.</p>
        </div>
        <button className="primary-button" onClick={onStart} disabled={selectedCount === 0 || running}>
          <PlayIcon />
          {running ? "Running" : "Start run"}
        </button>
      </div>

      <div className="run-controls">
        <label className="toggle-row">
          <input type="checkbox" checked={dryRun} onChange={(event) => onDryRunChange(event.target.checked)} />
          <span>Dry run</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={headless} onChange={(event) => onHeadlessChange(event.target.checked)} />
          <span>Headless browser</span>
        </label>
        <div className="selected-count">{selectedCount} selected</div>
      </div>

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
          <div className="empty-run">No run started yet.</div>
        ) : (
          job.accounts.map((accountState) => {
            const account = accountsById.get(accountState.accountId);
            return (
              <div key={accountState.accountId} className="run-row">
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
    </section>
  );
}

function labelForStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: string): string {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "running") {
    return "primary";
  }
  return "neutral";
}
