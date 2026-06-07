import type { WorkItem } from "../queues/types.js";
import type { AutomationJob } from "../services/inMemoryJobStore.js";
import type { WorkerRecord } from "../workers/types.js";

export interface OperationsMetricsInput {
  jobs: AutomationJob[];
  workItems: WorkItem[];
  workers: WorkerRecord[];
}

export interface OperationsMetrics {
  totalRuns: number;
  runningJobs: number;
  queueDepth: number;
  leasedItems: number;
  activeWorkers: number;
  offlineWorkers: number;
  successRate: number;
  retryRate: number;
  averageDurationMs: number;
  failureCategories: Record<string, number>;
}

export function computeOperationsMetrics(input: OperationsMetricsInput): OperationsMetrics {
  const terminalJobs = input.jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status));
  const completedJobs = terminalJobs.filter((job) => job.status === "completed");
  const retryableItems = input.workItems.filter((item) => item.attempt > 1);
  const durations = terminalJobs
    .map((job) => Date.parse(job.updatedAt) - Date.parse(job.createdAt))
    .filter((duration) => Number.isFinite(duration) && duration >= 0);

  return {
    totalRuns: input.jobs.length,
    runningJobs: input.jobs.filter((job) => job.status === "running").length,
    queueDepth: input.workItems.filter((item) => ["new", "retrying", "deferred", "leased"].includes(item.status)).length,
    leasedItems: input.workItems.filter((item) => item.status === "leased").length,
    activeWorkers: input.workers.filter((worker) => worker.status === "online").length,
    offlineWorkers: input.workers.filter((worker) => worker.status === "offline").length,
    successRate: terminalJobs.length === 0 ? 0 : Math.round((completedJobs.length / terminalJobs.length) * 100),
    retryRate: input.workItems.length === 0 ? 0 : Math.round((retryableItems.length / input.workItems.length) * 100),
    averageDurationMs: durations.length === 0 ? 0 : Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
    failureCategories: countFailureCategories(input.workItems)
  };
}

function countFailureCategories(workItems: WorkItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of workItems) {
    if (!item.failureCategory) continue;
    counts[item.failureCategory] = (counts[item.failureCategory] ?? 0) + 1;
  }
  return counts;
}
