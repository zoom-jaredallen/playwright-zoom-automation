import type { JobView } from "../api.js";

type RunAccountLog = NonNullable<JobView["accounts"][number]["logs"]>[number];

interface RunAccountTimelineProps {
  logs?: RunAccountLog[];
}

export function RunAccountTimeline({ logs = [] }: RunAccountTimelineProps) {
  const timeline = deriveTimeline(logs);

  return (
    <div className="run-timeline">
      <div className="run-timeline-summary">
        <TimelineStat label="Current" log={timeline.currentStep} />
        <TimelineStat label="Last success" log={timeline.lastSuccessfulStep} />
        <TimelineStat label="Failure" log={timeline.failedStep} />
      </div>
      <div className="run-timeline-list">
        {logs.length > 0 ? logs.map((log, index) => (
          <div key={`${log.timestamp}-${index}`} className={`run-timeline-entry ${log.level ?? "info"}`}>
            <span className="run-log-time">{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span className="run-timeline-dot" />
            <span className="run-timeline-copy">
              <strong>{log.stepName ?? log.step}</strong>
              {log.detail ? <small>{log.detail}</small> : null}
              {log.artifactRefs?.length ? (
                <span className="run-timeline-artifacts">
                  {log.artifactRefs.map((artifact) => (
                    <a key={`${artifact.type}-${artifact.url}`} href={artifact.url} target="_blank" rel="noreferrer">
                      {artifact.label ?? artifact.type}
                    </a>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
        )) : <div className="run-log-empty">No step logs recorded yet.</div>}
      </div>
    </div>
  );
}

function TimelineStat({ label, log }: { label: string; log?: RunAccountLog }) {
  return (
    <div className="run-timeline-stat">
      <span>{label}</span>
      <strong>{log?.stepName ?? log?.step ?? "—"}</strong>
    </div>
  );
}

function deriveTimeline(logs: RunAccountLog[]): {
  currentStep?: RunAccountLog;
  lastSuccessfulStep?: RunAccountLog;
  failedStep?: RunAccountLog;
} {
  const structured = logs.filter((log) => log.level || log.stepId || log.stepName);
  return {
    currentStep: [...structured].reverse().find((log) => log.level !== "success") ?? logs.at(-1),
    lastSuccessfulStep: [...structured].reverse().find((log) => log.level === "success"),
    failedStep: [...structured].reverse().find((log) => log.level === "error")
  };
}
