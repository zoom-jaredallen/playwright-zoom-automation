import type { BulkPreflightView, PreflightIssueView, PreflightOutcomeView } from "../api.js";

interface PreflightPanelProps {
  preflight?: BulkPreflightView;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onRun(): void;
}

export function PreflightPanel({ preflight, loading, error, disabled, onRun }: PreflightPanelProps) {
  return (
    <section className="configure-section preflight-panel">
      <div className="configure-section-header">
        <h3>Bulk Preflight</h3>
        <button className="secondary-button" onClick={onRun} disabled={disabled || loading}>
          {loading ? "Checking" : "Run preflight"}
        </button>
      </div>
      <p className="configure-hint">Simulate selected recorded workflows against the account set before starting a bulk run.</p>
      {error ? <p className="import-error">{error}</p> : null}
      {preflight ? (
        <>
          <div className="preflight-summary">
            {(["willRun", "willSkip", "needsReview", "willFail"] as PreflightOutcomeView[]).map((outcome) => (
              <div key={outcome} className={`preflight-metric ${outcome}`}>
                <strong>{preflight.summary[outcome]}</strong>
                <span>{labelFor(outcome)}</span>
              </div>
            ))}
          </div>
          <div className="preflight-account-list">
            {preflight.accounts.slice(0, 8).map((account) => (
              <div key={account.accountId} className="preflight-account-row">
                <span>
                  <strong>{account.ownerEmail ?? account.accountName ?? account.accountId}</strong>
                  <small>{topIssueMessage(account.workflowOutcomes) ?? "No preflight issues"}</small>
                </span>
                <span className={`status-badge ${badgeClass(account.predictedOutcome)}`}>{labelFor(account.predictedOutcome)}</span>
              </div>
            ))}
            {preflight.accounts.length > 8 ? <small className="configure-hint">Showing 8 of {preflight.accounts.length} accounts.</small> : null}
          </div>
        </>
      ) : (
        <p className="configure-hint">Run preflight after selecting accounts and recorded workflows.</p>
      )}
    </section>
  );
}

function topIssueMessage(workflowOutcomes: BulkPreflightView["accounts"][number]["workflowOutcomes"]): string | undefined {
  const issue = workflowOutcomes
    .flatMap((workflow) => workflow.issues.map((item) => ({ ...item, workflowName: workflow.workflowName })))
    .sort((a, b) => issuePriority(b) - issuePriority(a))[0];
  if (!issue) return undefined;
  return workflowOutcomes.length > 1 ? `${issue.workflowName}: ${issue.message}` : issue.message;
}

function issuePriority(issue: PreflightIssueView): number {
  if (issue.severity === "blocking") return 3;
  if (issue.severity === "warning") return 2;
  return 1;
}

function labelFor(outcome: PreflightOutcomeView): string {
  if (outcome === "willRun") return "Will run";
  if (outcome === "willSkip") return "Will skip";
  if (outcome === "needsReview") return "Needs review";
  return "Will fail";
}

function badgeClass(outcome: PreflightOutcomeView): string {
  if (outcome === "willRun") return "primary";
  if (outcome === "willSkip") return "neutral";
  if (outcome === "needsReview") return "warning";
  return "error";
}
