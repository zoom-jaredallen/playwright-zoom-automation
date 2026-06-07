import { useState } from "react";
import type { JobView } from "../api.js";
import { RefreshIcon } from "./Icons.js";

interface JobHistoryPanelProps {
  jobs: JobView[];
  onRetry(job: JobView, statuses: Array<"failed" | "skipped">): void;
  onRefresh(): void;
}

export function JobHistoryPanel({ jobs, onRetry, onRefresh }: JobHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredJobs = statusFilter === "all"
    ? jobs
    : jobs.filter((job) => job.status === statusFilter);

  return (
    <section className="panel" id="history">
      <div className="panel-header">
        <div>
          <h2>Past runs</h2>
          <p>{jobs.length} run{jobs.length !== 1 ? "s" : ""} recorded</p>
        </div>
        <button className="tertiary-button" onClick={onRefresh}>
          <RefreshIcon /> Refresh
        </button>
      </div>

      <div className="history-filters">
        {["all", "completed", "failed", "cancelled"].map((status) => (
          <button
            key={status}
            className={`filter-chip ${statusFilter === status ? "active" : ""}`}
            onClick={() => setStatusFilter(status)}
          >
            {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {filteredJobs.length === 0 ? (
        <div className="empty-run">No runs match the current filter.</div>
      ) : (
        <div className="history-list">
          {filteredJobs.map((job) => {
            const expanded = expandedId === job.id;
            const failedCount = job.summary.failed;
            const skippedCount = job.summary.skipped;
            return (
              <div key={job.id} className="history-item">
                <button
                  className="history-row"
                  onClick={() => setExpandedId(expanded ? undefined : job.id)}
                >
                  <div className="history-row-main">
                    <span className={`status-badge ${jobStatusClass(job.status)}`}>
                      {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                    </span>
                    <div className="history-row-info">
                      <strong>{job.input.workflowIds.join(", ")}</strong>
                      <small>
                        {job.input.accountIds.length} accounts • {job.input.addressProfile}
                        {job.input.dryRun ? " • Dry run" : ""}
                      </small>
                    </div>
                  </div>
                  <div className="history-row-meta">
                    <small>{formatDate(job.createdAt)}</small>
                    <small className="history-summary">
                      ✓{job.summary.completed} ○{job.summary.skipped} ✗{job.summary.failed}
                    </small>
                  </div>
                </button>

                {expanded ? (
                  <div className="history-detail">
                    <div className="history-detail-header">
                      <span>Job ID: {job.id.slice(0, 8)}…</span>
                      {failedCount > 0 ? (
                        <button className="tertiary-button" onClick={() => onRetry(job, ["failed"])}>
                          Retry {failedCount} failed
                        </button>
                      ) : null}
                      {skippedCount > 0 ? (
                        <button className="tertiary-button" onClick={() => onRetry(job, ["skipped"])}>
                          Retry {skippedCount} skipped
                        </button>
                      ) : null}
                      <button className="tertiary-button" onClick={() => exportJobCsv(job)}>
                        Export CSV
                      </button>
                    </div>
                    <div className="history-accounts">
                      {job.accounts.map((accountState) => (
                        <div key={accountState.accountId} className="history-account-row">
                          <code>{accountState.accountId.slice(0, 12)}…</code>
                          <span className={`status-badge ${accountStatusClass(accountState.status)}`}>
                            {accountState.status}
                          </span>
                          <span className="history-account-detail">
                            {accountState.message ?? accountState.error ?? ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {job.events.length > 0 ? (
                      <div className="history-events">
                        {job.events.map((event, index) => (
                          <div key={index} className="history-event">
                            <small>{formatTime(event.timestamp)}</small>
                            <span>{event.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function jobStatusClass(status: string): string {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "cancelled") return "warning";
  if (status === "running") return "primary";
  return "neutral";
}

function accountStatusClass(status: string): string {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "skipped") return "neutral";
  if (status === "running") return "primary";
  return "neutral";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function exportJobCsv(job: JobView): void {
  const rows = [["Account ID", "Status", "Workflow", "Message", "Error"].join(",")];
  for (const a of job.accounts) {
    rows.push([
      a.accountId,
      a.status,
      a.workflowId ?? "",
      csvEscape(a.message ?? ""),
      csvEscape(a.error ?? "")
    ].join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `job-${job.id.slice(0, 8)}-results.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
