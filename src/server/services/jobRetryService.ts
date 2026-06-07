import type { AutomationJob, CreateJobInput, JobAccountStatus } from "./inMemoryJobStore.js";

export interface RetryAccountSelector {
  statuses: JobAccountStatus[];
  messageIncludes?: string;
}

export function selectRetryAccounts(job: AutomationJob, selector: RetryAccountSelector): string[] {
  const statuses = new Set(selector.statuses);
  const messageNeedle = selector.messageIncludes?.toLowerCase();
  return job.accounts
    .filter((account) => statuses.has(account.status))
    .filter((account) => {
      if (!messageNeedle) return true;
      return [account.message, account.error].filter(Boolean).join(" ").toLowerCase().includes(messageNeedle);
    })
    .map((account) => account.accountId);
}

export function createRetryJobInput(sourceJob: AutomationJob, accountIds: string[]): CreateJobInput {
  return {
    accountIds: [...accountIds],
    workflowIds: [...sourceJob.input.workflowIds],
    dryRun: sourceJob.input.dryRun,
    addressProfile: sourceJob.input.addressProfile,
    sourceJobId: sourceJob.id,
    retryOfAccountIds: [...accountIds]
  };
}
