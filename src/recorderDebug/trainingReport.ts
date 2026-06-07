import type { RecordedAction } from "@zoom-automation/workflow-core";
import type {
  RecorderActionDiff,
  RecorderDebugTestEvent,
  RecorderTrainingIteration,
  RecorderTrainingReport,
  RecorderTrainingStepHealth,
  RecorderWorkflowAudit
} from "./types.js";

export interface BuildRecorderTrainingReportInput {
  sessionId: string;
  workflowName?: string;
  startedAt: string;
  finishedAt: string;
  actions: RecordedAction[];
  iterations: RecorderTrainingIteration[];
  qualityScore?: number;
}

export interface BuildWorkflowAuditInput {
  rawActions: RecordedAction[];
  preparedActions: RecordedAction[];
  qualityScore?: number;
}

export function buildRecorderTrainingReport(input: BuildRecorderTrainingReportInput): RecorderTrainingReport {
  const passed = input.iterations.filter((iteration) => iteration.ok).length;
  const failed = input.iterations.length - passed;
  const completionRate = percent(passed, input.iterations.length);
  const stepHealth = buildStepHealth(input.actions, input.iterations);
  const failingSteps = stepHealth.filter((step) => step.failures > 0).length;
  const qualityScore = input.qualityScore ?? 75;
  const score = clampScore(Math.round((completionRate * 0.65) + (qualityScore * 0.25) + ((100 - failingSteps * 15) * 0.10)));

  return {
    sessionId: input.sessionId,
    workflowName: input.workflowName,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    summary: {
      iterations: input.iterations.length,
      passed,
      failed,
      completionRate,
      score
    },
    iterations: input.iterations,
    stepHealth,
    recommendations: buildTrainingRecommendations(stepHealth, input.actions, qualityScore)
  };
}

export function buildWorkflowAudit(input: BuildWorkflowAuditInput): RecorderWorkflowAudit {
  const riskySteps = input.preparedActions
    .map((action) => ({ action, reasons: riskReasons(action) }))
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ action, reasons }) => ({
      actionId: action.id,
      description: action.description,
      reasons
    }));
  const duplicateNoise = Math.max(0, input.rawActions.length - input.preparedActions.length);
  const score = clampScore((input.qualityScore ?? 80) - riskySteps.length * 8 - duplicateNoise * 3);
  const recommendations = new Set<string>();

  if (duplicateNoise > 0) {
    recommendations.add(`Review recorder noise: ${duplicateNoise} raw step(s) were removed from prepared workflow output.`);
  }
  if (input.preparedActions.some((action) => action.type === "fill" && hasHardcodedValue(action))) {
    recommendations.add("Parameterize hardcoded fill values before running the workflow across many accounts.");
  }
  if (input.preparedActions.some((action) => action.type === "click" && /save|submit|add/i.test(action.description ?? ""))) {
    recommendations.add("Add an assertion or screenshot evidence step after submit/save actions.");
  }
  for (const risky of riskySteps) {
    recommendations.add(`Improve selector for ${risky.actionId}: ${risky.reasons.join(", ")}.`);
  }

  return { score, riskySteps, recommendations: [...recommendations] };
}

export function diffRecordedActions(input: Pick<BuildWorkflowAuditInput, "rawActions" | "preparedActions">): RecorderActionDiff {
  const preparedIds = new Set(input.preparedActions.map((action) => action.id));
  return {
    rawCount: input.rawActions.length,
    preparedCount: input.preparedActions.length,
    removed: input.rawActions
      .filter((action) => !preparedIds.has(action.id))
      .map((action) => ({ id: action.id, type: action.type, description: action.description }))
  };
}

export function formatTrainingReportSummary(report: RecorderTrainingReport): string {
  const worstSteps = [...report.stepHealth]
    .filter((step) => step.failures > 0)
    .sort((a, b) => b.failureRate - a.failureRate)
    .slice(0, 3);
  return [
    `Training report: ${report.workflowName ?? report.sessionId}`,
    `Training score: ${report.summary.score}`,
    `Iterations: ${report.summary.passed}/${report.summary.iterations} passed (${report.summary.completionRate}%)`,
    worstSteps.length > 0
      ? `Needs attention: ${worstSteps.map((step) => `${step.actionId} ${step.failureRate}% failed`).join(", ")}`
      : "Needs attention: none",
    `Recommendations: ${report.recommendations.length}`
  ].join("\n");
}

function buildStepHealth(actions: RecordedAction[], iterations: RecorderTrainingIteration[]): RecorderTrainingStepHealth[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const ids = new Set<string>(actions.map((action) => action.id));
  for (const iteration of iterations) {
    for (const event of iteration.events) {
      if (event.actionId) ids.add(event.actionId);
    }
    if (iteration.failedActionId) ids.add(iteration.failedActionId);
  }

  return [...ids].map((actionId) => {
    const relatedEvents = iterations.flatMap((iteration) => iteration.events.filter((event) => event.actionId === actionId));
    const failures = relatedEvents.filter((event) => event.level === "error").length;
    const passes = relatedEvents.filter((event) => event.level === "success" && /^Passed:/i.test(event.message)).length;
    const attempts = Math.max(passes + failures, relatedEvents.length > 0 ? 1 : 0);
    return {
      actionId,
      description: byId.get(actionId)?.description,
      attempts,
      passes,
      failures,
      failureRate: percent(failures, attempts),
      lastError: lastError(relatedEvents)
    };
  }).filter((step) => step.attempts > 0);
}

function buildTrainingRecommendations(stepHealth: RecorderTrainingStepHealth[], actions: RecordedAction[], qualityScore: number): string[] {
  const recommendations = new Set<string>();
  for (const step of stepHealth.filter((candidate) => candidate.failures > 0)) {
    recommendations.add(`Review step ${step.actionId}${step.description ? ` (${step.description})` : ""}: ${step.failureRate}% failure rate.`);
  }
  if (qualityScore < 75) {
    recommendations.add("Improve workflow quality before bulk runs: selector stability, assertions, or evidence coverage are below target.");
  }
  if (actions.some((action) => action.type === "click" && /save|submit|add/i.test(action.description ?? ""))) {
    recommendations.add("Add a verification step after submit/save so training can prove the workflow changed the page.");
  }
  if (actions.some((action) => action.type === "fill" && hasHardcodedValue(action))) {
    recommendations.add("Parameterize hardcoded values so the workflow can be reused across accounts and countries.");
  }
  return [...recommendations];
}

function riskReasons(action: RecordedAction): string[] {
  const reasons: string[] = [];
  const selectors = action.selectors;
  if (selectors.css && !selectors.role && !selectors.label && !selectors.text && !selectors.testId && !selectors.anchor) {
    reasons.push("CSS-only selector");
  }
  if (action.type === "click" && !selectors.role && !selectors.text && !selectors.label && !selectors.testId) {
    reasons.push("weak click target");
  }
  if (action.type === "fill" && hasHardcodedValue(action)) {
    reasons.push("hardcoded fill value");
  }
  return reasons;
}

function hasHardcodedValue(action: RecordedAction): boolean {
  return typeof action.value === "string" && action.value.trim().length > 0 && (action.parameterHints?.length ?? 0) === 0;
}

function lastError(events: RecorderDebugTestEvent[]): string | undefined {
  return [...events].reverse().find((event) => event.level === "error")?.message;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}
