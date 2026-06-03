import type { JobView, SubAccountView } from "../api.js";

interface RunStepProps {
  job?: JobView;
  accountsById: Map<string, SubAccountView>;
  pipelineOrder: string[];
  workflowNames: Map<string, string>;
  onCancel?(): void;
  onBack(): void;
  onNewRun(): void;
}

export function RunStep({ job, accountsById, pipelineOrder, workflowNames, onCancel, onBack, onNewRun }: RunStepProps) {
  if (!job) {
    return (
      <div className="run-step-empty">
        <p>Preparing to start automation...</p>
      </div>
    );
  }

  const isRunning = ["queued", "running"].includes(job.status);
  const isFinished = ["completed", "failed", "cancelled"].includes(job.status);

  return (
    <div className="run-step">
      {/* Summary bar */}
      <div className="run-summary-bar">
        <div className="run-summary-status">
          <span className={`run-status-dot ${job.status}`} />
          <strong>{statusLabel(job.status)}</strong>
          {job.events.length > 0 ? (
            <span className="run-status-message">{job.events[job.events.length - 1].message}</span>
          ) : null}
        </div>
        <div className="run-summary-actions">
          {isRunning && onCancel ? (
            <button className="danger-button" onClick={onCancel}>Cancel run</button>
          ) : null}
          {isFinished ? (
            <button className="primary-button" onClick={onNewRun}>New run</button>
          ) : null}
        </div>
      </div>

      {/* Progress bar */}
      <div className="run-progress-bar">
        <div
          className="run-progress-fill"
          style={{ width: `${progressPercent(job)}%` }}
        />
      </div>

      {/* Stats */}
      <div className="run-stats">
        <div className="run-stat">
          <span className="run-stat-value">{job.summary.completed}</span>
          <span className="run-stat-label">Completed</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value run-stat-running">{job.summary.running}</span>
          <span className="run-stat-label">Running</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value run-stat-failed">{job.summary.failed}</span>
          <span className="run-stat-label">Failed</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value">{job.summary.skipped}</span>
          <span className="run-stat-label">Skipped</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value">{job.summary.queued}</span>
          <span className="run-stat-label">Queued</span>
        </div>
      </div>

      {/* Account list with per-account progress */}
      <div className="run-account-list">
        <div className="run-account-header">
          <span>Account</span>
          <span>Workflow</span>
          <span>Status</span>
          <span>Progress</span>
        </div>
        {job.accounts.map((accountState) => {
          const account = accountsById.get(accountState.accountId);
          const workflowName = accountState.workflowId
            ? workflowNames.get(accountState.workflowId) ?? accountState.workflowId
            : pipelineOrder.length > 0
            ? workflowNames.get(pipelineOrder[0]) ?? "—"
            : "—";

          return (
            <div
              key={accountState.accountId}
              className={`run-account-row ${accountState.status}`}
            >
              <span className="run-account-name">
                <strong>{account?.name ?? accountState.accountId}</strong>
                {account?.ownerEmail ? <small>{account.ownerEmail}</small> : null}
              </span>
              <span className="run-account-workflow">{workflowName}</span>
              <span className="run-account-status">
                <span className={`run-account-dot ${accountState.status}`} />
                {statusLabel(accountState.status)}
              </span>
              <span className="run-account-progress">
                {accountState.status === "running" ? (
                  <span className="run-account-spinner">
                    <span className="spinner" />
                    {accountState.message ?? "Processing..."}
                  </span>
                ) : accountState.status === "completed" ? (
                  <span className="run-account-done">✓ {accountState.message ?? "Done"}</span>
                ) : accountState.status === "failed" ? (
                  <span className="run-account-error" title={accountState.error}>
                    ✗ {accountState.error?.slice(0, 60) ?? "Failed"}
                  </span>
                ) : accountState.status === "skipped" ? (
                  <span className="run-account-skipped">○ {accountState.message ?? "Skipped"}</span>
                ) : (
                  <span className="run-account-queued">Waiting...</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {isFinished ? (
        <div className="wizard-footer">
          <button className="tertiary-button" onClick={onBack}>← Back to configure</button>
          <button className="primary-button" onClick={onNewRun}>Start new run</button>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    cancelled: "Cancelled"
  };
  return labels[status] ?? status;
}

function progressPercent(job: JobView): number {
  const total = job.accounts.length;
  if (total === 0) return 0;
  const done = job.summary.completed + job.summary.failed + job.summary.skipped;
  return Math.round((done / total) * 100);
}
