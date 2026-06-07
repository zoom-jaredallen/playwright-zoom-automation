import type { RunReadinessView } from "../api.js";

interface RunReadinessPanelProps {
  readiness?: RunReadinessView;
  loading?: boolean;
  error?: string;
}

export function RunReadinessPanel({ readiness, loading, error }: RunReadinessPanelProps) {
  return (
    <section className="configure-section readiness-panel">
      <div className="configure-section-header">
        <h3>Run Readiness</h3>
        {loading ? <span className="status-badge neutral">Checking</span> : readiness?.ready ? <span className="status-badge success">Ready</span> : <span className="status-badge error">Blocked</span>}
      </div>
      {error ? <p className="import-error">{error}</p> : null}
      {!readiness && !error ? <p className="configure-hint">Readiness checks run automatically before launch.</p> : null}
      {readiness ? (
        <div className="readiness-list">
          {readiness.checks.map((check) => (
            <div key={check.id} className={`readiness-item ${check.severity}`}>
              <span className="readiness-icon">{iconFor(check.severity)}</span>
              <span>
                <strong>{check.label}</strong>
                <small>{check.message}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function iconFor(severity: RunReadinessView["checks"][number]["severity"]): string {
  if (severity === "pass") return "✓";
  if (severity === "warning") return "!";
  return "×";
}
