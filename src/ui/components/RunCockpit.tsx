import type { RunCockpitView } from "../api.js";

export type RunFilter = "all" | "failed" | "skipped" | "needsReview" | "noAddressFound";

interface RunCockpitProps {
  cockpit?: RunCockpitView;
  filter: RunFilter;
  onFilterChange(filter: RunFilter): void;
  onRetryFailed?(): void;
  onRetrySkipped?(): void;
  exportUrl?: string;
  traceUrl?: string;
}

export function RunCockpit({ cockpit, filter, onFilterChange, onRetryFailed, onRetrySkipped, exportUrl, traceUrl }: RunCockpitProps) {
  if (!cockpit) return null;

  return (
    <section className="run-cockpit">
      <div className="run-cockpit-header">
        <div>
          <h3>Run cockpit</h3>
          <p>{cockpit.progress.finishedAccounts} of {cockpit.progress.totalAccounts} accounts finished · {cockpit.progress.percent}%</p>
        </div>
        <div className="run-cockpit-actions">
          {onRetryFailed ? <button className="tertiary-button" onClick={onRetryFailed} disabled={cockpit.quickFilters.failed.length === 0}>Retry failed</button> : null}
          {onRetrySkipped ? <button className="tertiary-button" onClick={onRetrySkipped} disabled={cockpit.quickFilters.skipped.length === 0}>Retry skipped</button> : null}
          {exportUrl ? <a className="tertiary-button" href={exportUrl}>Export report</a> : null}
          {traceUrl ? <a className="tertiary-button" href={traceUrl} target="_blank" rel="noreferrer">Open traces</a> : null}
        </div>
      </div>

      <div className="run-cockpit-grid">
        <CockpitTile label="Queued" value={cockpit.progress.queued} />
        <CockpitTile label="Running" value={cockpit.progress.running} tone="primary" />
        <CockpitTile label="Completed" value={cockpit.progress.completed} tone="success" />
        <CockpitTile label="Skipped" value={cockpit.progress.skipped} tone="warning" />
        <CockpitTile label="Failed" value={cockpit.progress.failed} tone="error" />
      </div>

      <div className="run-cockpit-panels">
        <div className="run-cockpit-panel">
          <strong>Current activity</strong>
          {cockpit.currentAccounts.length > 0 ? (
            cockpit.currentAccounts.map((account) => (
              <span key={account.accountId}>{account.accountId}: {account.message ?? "Processing"}</span>
            ))
          ) : (
            <span>No active account right now.</span>
          )}
          {cockpit.retriesInProgress.length > 0 ? <span>{cockpit.retriesInProgress.length} retry account(s) in this run.</span> : null}
        </div>
        <div className="run-cockpit-panel">
          <strong>Failure categories</strong>
          {Object.keys(cockpit.failureCategories).length > 0 ? (
            Object.entries(cockpit.failureCategories).map(([category, count]) => <span key={category}>{category}: {count}</span>)
          ) : (
            <span>No failures categorized.</span>
          )}
        </div>
      </div>

      <div className="run-filter-bar" role="group" aria-label="Run account filters">
        <FilterButton label="All" active={filter === "all"} count={cockpit.progress.totalAccounts} onClick={() => onFilterChange("all")} />
        <FilterButton label="Failed" active={filter === "failed"} count={cockpit.quickFilters.failed.length} onClick={() => onFilterChange("failed")} />
        <FilterButton label="Skipped" active={filter === "skipped"} count={cockpit.quickFilters.skipped.length} onClick={() => onFilterChange("skipped")} />
        <FilterButton label="Needs review" active={filter === "needsReview"} count={cockpit.quickFilters.needsReview.length} onClick={() => onFilterChange("needsReview")} />
        <FilterButton label="No address found" active={filter === "noAddressFound"} count={cockpit.quickFilters.noAddressFound.length} onClick={() => onFilterChange("noAddressFound")} />
      </div>
    </section>
  );
}

function CockpitTile({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`run-cockpit-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick(): void }) {
  return (
    <button className={`filter-chip ${active ? "active" : ""}`} onClick={onClick}>
      {label} <span>{count}</span>
    </button>
  );
}
