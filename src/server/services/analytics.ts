/**
 * Analytics Service — aggregates job history into dashboard metrics.
 * Provides summary statistics, trends, and account health data.
 */
import type { AutomationJob, JobAccountStatus } from "./inMemoryJobStore.js";

export interface DashboardMetrics {
  /** Overall statistics */
  totals: {
    totalRuns: number;
    totalAccounts: number;
    successRate: number;
    averageDurationMs: number;
  };
  /** Status breakdown */
  statusBreakdown: {
    completed: number;
    failed: number;
    cancelled: number;
  };
  /** Recent activity (last 7 days) */
  recentActivity: {
    runsToday: number;
    runsThisWeek: number;
    accountsProcessedToday: number;
  };
  /** Most problematic accounts */
  troubleAccounts: Array<{
    accountId: string;
    failureCount: number;
    lastError?: string;
    lastFailedAt?: string;
  }>;
  /** Workflow performance */
  workflowStats: Array<{
    workflowId: string;
    runCount: number;
    successRate: number;
    averageDurationMs: number;
  }>;
  /** Daily run counts for charting (last 14 days) */
  dailyRuns: Array<{
    date: string;
    completed: number;
    failed: number;
    total: number;
  }>;
}

/**
 * Compute dashboard metrics from job history.
 */
export function computeDashboardMetrics(jobs: AutomationJob[]): DashboardMetrics {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1_000;

  // Overall totals
  const finishedJobs = jobs.filter((j) => ["completed", "failed", "cancelled"].includes(j.status));
  const successfulJobs = jobs.filter((j) => j.status === "completed");
  const totalAccounts = jobs.reduce((sum, j) => sum + j.accounts.length, 0);
  const successRate = finishedJobs.length > 0
    ? Math.round((successfulJobs.length / finishedJobs.length) * 100)
    : 0;

  const durations = finishedJobs
    .map((j) => new Date(j.updatedAt).getTime() - new Date(j.createdAt).getTime())
    .filter((d) => d > 0);
  const averageDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Status breakdown
  const statusBreakdown = {
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    cancelled: jobs.filter((j) => j.status === "cancelled").length
  };

  // Recent activity
  const todayJobs = jobs.filter((j) => new Date(j.createdAt).getTime() >= todayStart);
  const weekJobs = jobs.filter((j) => new Date(j.createdAt).getTime() >= weekStart);
  const accountsToday = todayJobs.reduce((sum, j) => sum + j.accounts.length, 0);

  // Trouble accounts (most failures)
  const accountFailures = new Map<string, { count: number; lastError?: string; lastFailedAt?: string }>();
  for (const job of jobs) {
    for (const account of job.accounts) {
      if (account.status === "failed") {
        const existing = accountFailures.get(account.accountId) ?? { count: 0 };
        existing.count += 1;
        existing.lastError = account.error;
        existing.lastFailedAt = account.completedAt;
        accountFailures.set(account.accountId, existing);
      }
    }
  }
  const troubleAccounts = Array.from(accountFailures.entries())
    .map(([accountId, data]) => ({ accountId, failureCount: data.count, lastError: data.lastError, lastFailedAt: data.lastFailedAt }))
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 10);

  // Workflow stats
  const workflowMap = new Map<string, { runs: number; successes: number; durations: number[] }>();
  for (const job of finishedJobs) {
    for (const wfId of job.input.workflowIds) {
      const existing = workflowMap.get(wfId) ?? { runs: 0, successes: 0, durations: [] };
      existing.runs += 1;
      if (job.status === "completed") existing.successes += 1;
      const duration = new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime();
      if (duration > 0) existing.durations.push(duration);
      workflowMap.set(wfId, existing);
    }
  }
  const workflowStats = Array.from(workflowMap.entries()).map(([workflowId, data]) => ({
    workflowId,
    runCount: data.runs,
    successRate: data.runs > 0 ? Math.round((data.successes / data.runs) * 100) : 0,
    averageDurationMs: data.durations.length > 0
      ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
      : 0
  }));

  // Daily runs (last 14 days)
  const dailyRuns: Array<{ date: string; completed: number; failed: number; total: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date(todayStart - i * 24 * 60 * 60 * 1_000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
    const dayJobs = jobs.filter((j) => {
      const created = new Date(j.createdAt).getTime();
      return created >= dayStart.getTime() && created < dayEnd.getTime();
    });
    dailyRuns.push({
      date: dayStart.toISOString().slice(0, 10),
      completed: dayJobs.filter((j) => j.status === "completed").length,
      failed: dayJobs.filter((j) => j.status === "failed").length,
      total: dayJobs.length
    });
  }

  return {
    totals: { totalRuns: jobs.length, totalAccounts, successRate, averageDurationMs },
    statusBreakdown,
    recentActivity: { runsToday: todayJobs.length, runsThisWeek: weekJobs.length, accountsProcessedToday: accountsToday },
    troubleAccounts,
    workflowStats,
    dailyRuns
  };
}
