import type { RecordedAction } from "../shared/types.js";
import type { RecorderTrainingIteration, RecorderTrainingReport } from "../shared/debugBridge.js";

export function buildExtensionTrainingReport(input: {
  sessionId: string;
  workflowName?: string;
  startedAt: string;
  finishedAt: string;
  actions: RecordedAction[];
  iterations: RecorderTrainingIteration[];
  qualityScore?: number;
}): RecorderTrainingReport {
  const passed = input.iterations.filter((iteration) => iteration.ok).length;
  const failed = input.iterations.length - passed;
  const completionRate = percentage(passed, input.iterations.length);
  const stepHealth = buildExtensionStepHealth(input.actions, input.iterations);
  const failingSteps = stepHealth.filter((step) => step.failures > 0);
  const qualityScore = input.qualityScore ?? 75;
  const score = clampTrainingScore(Math.round((completionRate * 0.65) + (qualityScore * 0.25) + ((100 - failingSteps.length * 15) * 0.10)));
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
    recommendations: buildExtensionTrainingRecommendations(input.actions, stepHealth, qualityScore)
  };
}

export function boundedPositiveInteger(value: unknown, defaultValue: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : defaultValue;
  if (!Number.isInteger(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

function buildExtensionStepHealth(actions: RecordedAction[], iterations: RecorderTrainingIteration[]): RecorderTrainingReport["stepHealth"] {
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const ids = new Set(actions.map((action) => action.id));
  for (const iteration of iterations) {
    for (const event of iteration.events) {
      if (event.actionId) ids.add(event.actionId);
    }
    if (iteration.failedActionId) ids.add(iteration.failedActionId);
  }
  return [...ids].map((actionId) => {
    const events = iterations.flatMap((iteration) => iteration.events.filter((event) => event.actionId === actionId));
    const failures = events.filter((event) => event.level === "error").length;
    const passes = events.filter((event) => event.level === "success" && /^Passed:/i.test(event.message)).length;
    const attempts = Math.max(passes + failures, events.length > 0 ? 1 : 0);
    return {
      actionId,
      description: actionById.get(actionId)?.description,
      attempts,
      passes,
      failures,
      failureRate: percentage(failures, attempts),
      lastError: [...events].reverse().find((event) => event.level === "error")?.message
    };
  }).filter((step) => step.attempts > 0);
}

function buildExtensionTrainingRecommendations(
  actions: RecordedAction[],
  stepHealth: RecorderTrainingReport["stepHealth"],
  qualityScore: number
): string[] {
  const recommendations = new Set<string>();
  for (const step of stepHealth.filter((candidate) => candidate.failures > 0)) {
    recommendations.add(`Review step ${step.actionId}${step.description ? ` (${step.description})` : ""}: ${step.failureRate}% failure rate.`);
  }
  if (qualityScore < 75) {
    recommendations.add("Improve selector stability, assertions, or evidence coverage before bulk runs.");
  }
  if (actions.some((action) => action.type === "click" && /save|submit|add/i.test(action.description ?? ""))) {
    recommendations.add("Add a verification step after submit/save actions.");
  }
  return [...recommendations];
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function clampTrainingScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}
