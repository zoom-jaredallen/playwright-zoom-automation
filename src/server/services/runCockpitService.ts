import type { AutomationJob, JobAccountState } from "./inMemoryJobStore.js";

export interface RunCockpitView {
  progress: {
    totalAccounts: number;
    finishedAccounts: number;
    percent: number;
    queued: number;
    running: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  currentAccounts: Array<{ accountId: string; message?: string }>;
  retriesInProgress: string[];
  quickFilters: {
    failed: string[];
    skipped: string[];
    needsReview: string[];
    noAddressFound: string[];
  };
  failureCategories: Record<string, number>;
}

export function buildRunCockpit(job: AutomationJob): RunCockpitView {
  const totalAccounts = job.accounts.length;
  const finishedAccounts = job.summary.completed + job.summary.failed + job.summary.skipped;
  const failed = job.accounts.filter((account) => account.status === "failed").map((account) => account.accountId);
  const skipped = job.accounts.filter((account) => account.status === "skipped").map((account) => account.accountId);
  const noAddressFound = job.accounts.filter(isNoAddressFound).map((account) => account.accountId);

  return {
    progress: {
      totalAccounts,
      finishedAccounts,
      percent: totalAccounts === 0 ? 0 : Math.round((finishedAccounts / totalAccounts) * 100),
      queued: job.summary.queued,
      running: job.summary.running,
      completed: job.summary.completed,
      skipped: job.summary.skipped,
      failed: job.summary.failed
    },
    currentAccounts: job.accounts
      .filter((account) => account.status === "running")
      .map((account) => ({ accountId: account.accountId, message: account.message })),
    retriesInProgress: job.input.retryOfAccountIds ?? [],
    quickFilters: {
      failed,
      skipped,
      needsReview: [...new Set([...failed, ...noAddressFound])],
      noAddressFound
    },
    failureCategories: countFailureCategories(job.accounts)
  };
}

function countFailureCategories(accounts: JobAccountState[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const account of accounts) {
    if (account.status !== "failed") continue;
    const category = categorizeFailure([account.error, account.message, ...(account.logs?.map((log) => log.detail ?? log.step) ?? [])].filter(Boolean).join(" "));
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function categorizeFailure(text: string): string {
  const value = text.toLowerCase();
  if (/login|password|captcha|mfa|auth/.test(value)) return "login";
  if (/impersonat|sub.?account/.test(value)) return "impersonation";
  if (/selector|locator|element not found|strict mode/.test(value)) return "selector";
  if (/assert|expected|verify|validation/.test(value)) return "assertion";
  if (/upload|file|document/.test(value)) return "upload";
  if (/timeout|timed out|networkidle/.test(value)) return "timeout";
  if (/popup|dialog|modal|announcement/.test(value)) return "zoomPopup";
  return "unknown";
}

function isNoAddressFound(account: JobAccountState): boolean {
  return /address not found|no address/i.test([account.message, account.error].filter(Boolean).join(" "));
}
