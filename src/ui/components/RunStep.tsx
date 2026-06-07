import { useEffect, useState } from "react";
import { fetchJobArtifacts, fetchRunCockpit, type ArtifactView, type JobView, type RunCockpitView, type SubAccountView } from "../api.js";
import { RunAccountTimeline } from "./RunAccountTimeline.js";
import { RunCockpit, type RunFilter } from "./RunCockpit.js";

type RunAccountState = JobView["accounts"][number];

interface RunStepProps {
  job?: JobView;
  accountsById: Map<string, SubAccountView>;
  pipelineOrder: string[];
  workflowNames: Map<string, string>;
  onCancel?(): void;
  onRetry?(job: JobView, statuses: Array<"failed" | "skipped">): void;
  onBack(): void;
  onNewRun(): void;
}

export function RunStep({ job, accountsById, pipelineOrder, workflowNames, onCancel, onRetry, onBack, onNewRun }: RunStepProps) {
  const [expandedAccountId, setExpandedAccountId] = useState<string | undefined>();
  const [artifactsByAccount, setArtifactsByAccount] = useState<Record<string, ArtifactView[]>>({});
  const [artifactErrors, setArtifactErrors] = useState<Record<string, string>>({});
  const [cockpit, setCockpit] = useState<RunCockpitView | undefined>();
  const [filter, setFilter] = useState<RunFilter>("all");

  useEffect(() => {
    if (!job || !expandedAccountId) return;
    if (artifactsByAccount[expandedAccountId] || artifactErrors[expandedAccountId]) return;
    void fetchJobArtifacts(job.id, expandedAccountId)
      .then((response) => {
        setArtifactsByAccount((current) => ({ ...current, [expandedAccountId]: response.artifacts }));
      })
      .catch((error) => {
        setArtifactErrors((current) => ({
          ...current,
          [expandedAccountId]: error instanceof Error ? error.message : String(error)
        }));
      });
  }, [artifactErrors, artifactsByAccount, expandedAccountId, job?.id]);

  useEffect(() => {
    if (!job) return;
    void fetchRunCockpit(job.id).then((response) => setCockpit(response.cockpit)).catch(() => setCockpit(undefined));
  }, [job?.id, job?.updatedAt, job?.summary.completed, job?.summary.failed, job?.summary.skipped, job?.summary.running]);

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

      <RunCockpit
        cockpit={cockpit}
        filter={filter}
        onFilterChange={setFilter}
        onRetryFailed={onRetry ? () => onRetry(job, ["failed"]) : undefined}
        onRetrySkipped={onRetry ? () => onRetry(job, ["skipped"]) : undefined}
        exportUrl={`/api/jobs/${job.id}/export?format=csv`}
        traceUrl={`/api/jobs/${job.id}/artifacts`}
      />

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
        {filteredAccounts(job, filter, cockpit).map((accountState) => {
          const account = accountsById.get(accountState.accountId);
          const workflowName = accountState.workflowId
            ? workflowNames.get(accountState.workflowId) ?? accountState.workflowId
            : pipelineOrder.length > 0
            ? workflowNames.get(pipelineOrder[0]) ?? "—"
            : "—";

          const isExpanded = expandedAccountId === accountState.accountId;
          const hasLogs = accountState.logs && accountState.logs.length > 0;
          const canExpand = canExpandRunAccount(accountState);

          return (
            <div key={accountState.accountId} className="run-account-block">
              <div
                className={`run-account-row ${accountState.status} ${canExpand ? "clickable" : ""}`}
                onClick={() => canExpand && setExpandedAccountId(isExpanded ? undefined : accountState.accountId)}
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
                  {canExpand ? (
                    <span className="run-account-expand">{isExpanded ? "▾" : "▸"}</span>
                  ) : null}
                </span>
              </div>

              {isExpanded ? (
                <div className="run-account-logs">
                  <div className="run-artifacts">
                    <div className="run-artifacts-header">
                      <strong>Artifacts</strong>
                      <a className="tertiary-button compact" href={`/api/jobs/${job.id}/artifacts?accountId=${encodeURIComponent(accountState.accountId)}`} target="_blank" rel="noreferrer">
                        View JSON
                      </a>
                    </div>
                    <ArtifactActions artifacts={artifactsByAccount[accountState.accountId] ?? []} error={artifactErrors[accountState.accountId]} />
                  </div>

                  <div className="run-step-log-header">
                    <strong>Step timeline</strong>
                  </div>
                  <RunAccountTimeline logs={accountState.logs} />
                </div>
              ) : null}
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

export function canExpandRunAccount(accountState: Pick<RunAccountState, "status" | "logs">): boolean {
  return Boolean(accountState.logs?.length) || ["running", "completed", "skipped", "failed"].includes(accountState.status);
}

function ArtifactActions({ artifacts, error }: { artifacts: ArtifactView[]; error?: string }) {
  if (error) {
    return <div className="run-log-empty">Artifact lookup failed: {error}</div>;
  }
  if (artifacts.length === 0) {
    return <div className="run-log-empty">No artifacts found for this account yet.</div>;
  }

  const trace = artifacts.find((artifact) => artifact.type === "trace");
  const screenshots = artifacts.filter((artifact) => artifact.type === "screenshot");
  const logs = artifacts.filter((artifact) => artifact.type === "log");
  const details = artifacts.filter((artifact) => artifact.type === "details");

  return (
    <div className="artifact-actions">
      {trace ? (
        <>
          <a className="tertiary-button compact" href={traceViewerUrl(trace.url)} target="_blank" rel="noreferrer">Open trace</a>
          <a className="tertiary-button compact" href={trace.url} download>Download trace</a>
        </>
      ) : null}
      {screenshots.length > 0 ? (
        <a className="tertiary-button compact" href={screenshots[0].url} target="_blank" rel="noreferrer">View screenshots ({screenshots.length})</a>
      ) : null}
      {logs.length > 0 ? (
        <a className="tertiary-button compact" href={logs[0].url} target="_blank" rel="noreferrer">View step logs</a>
      ) : null}
      {details.length > 0 ? (
        <a className="tertiary-button compact" href={details[0].url} target="_blank" rel="noreferrer">View failure details</a>
      ) : null}
      <div className="artifact-list">
        {artifacts.slice(0, 6).map((artifact) => (
          <a key={artifact.url} href={artifact.url} target="_blank" rel="noreferrer">
            <span className={`artifact-kind ${artifact.type}`}>{artifact.type}</span>
            <span>{artifact.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function traceViewerUrl(traceUrl: string): string {
  return `https://trace.playwright.dev/?trace=${encodeURIComponent(new URL(traceUrl, window.location.origin).toString())}`;
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

function filteredAccounts(job: JobView, filter: RunFilter, cockpit: RunCockpitView | undefined): JobView["accounts"] {
  if (filter === "all" || !cockpit) return job.accounts;
  const ids = new Set(cockpit.quickFilters[filter]);
  return job.accounts.filter((account) => ids.has(account.accountId));
}
