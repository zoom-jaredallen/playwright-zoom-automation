import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobAccountStatus = "queued" | "running" | "completed" | "skipped" | "failed";

export interface CreateJobInput {
  accountIds: string[];
  workflowIds: string[];
  dryRun: boolean;
  addressProfile: string;
}

export interface AccountLogEntry {
  timestamp: string;
  step: string;
  detail?: string;
}

export interface JobAccountState {
  accountId: string;
  workflowId?: string;
  status: JobAccountStatus;
  message?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  logs?: AccountLogEntry[];
}

export interface JobSummary {
  queued: number;
  running: number;
  completed: number;
  skipped: number;
  failed: number;
}

export interface AutomationJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  input: CreateJobInput;
  accounts: JobAccountState[];
  summary: JobSummary;
  events: Array<{
    timestamp: string;
    message: string;
  }>;
}

export interface JobStore {
  createJob(input: CreateJobInput): AutomationJob;
  getJob(id: string): AutomationJob | undefined;
  listJobs(): AutomationJob[];
  markJob(id: string, status: JobStatus, message?: string): AutomationJob;
  markAccount(id: string, accountId: string, patch: Partial<JobAccountState>): AutomationJob;
  logAccountStep(id: string, accountId: string, step: string, detail?: string): AutomationJob;
}

export function createJobStore(): JobStore {
  const jobs = new Map<string, AutomationJob>();

  const getMutableJob = (id: string): AutomationJob => {
    const job = jobs.get(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }
    return job;
  };

  return {
    createJob(input) {
      const now = new Date().toISOString();
      const job: AutomationJob = {
        id: randomUUID(),
        status: "queued",
        createdAt: now,
        updatedAt: now,
        input: {
          ...input,
          accountIds: [...input.accountIds],
          workflowIds: [...input.workflowIds]
        },
        accounts: input.accountIds.map((accountId) => ({
          accountId,
          status: "queued"
        })),
        summary: summarize(input.accountIds.map((accountId) => ({ accountId, status: "queued" }))),
        events: [{ timestamp: now, message: "Job created" }]
      };
      jobs.set(job.id, job);
      return cloneJob(job);
    },
    getJob(id) {
      const job = jobs.get(id);
      return job ? cloneJob(job) : undefined;
    },
    listJobs() {
      return Array.from(jobs.values()).map(cloneJob);
    },
    markJob(id, status, message) {
      const job = getMutableJob(id);
      const now = new Date().toISOString();
      job.status = status;
      job.updatedAt = now;
      if (message) {
        job.events.push({ timestamp: now, message });
      }
      return cloneJob(job);
    },
    markAccount(id, accountId, patch) {
      const job = getMutableJob(id);
      const account = job.accounts.find((item) => item.accountId === accountId);
      if (!account) {
        throw new Error(`Account is not part of job: ${accountId}`);
      }

      Object.assign(account, patch);
      if (patch.status === "running" && !account.startedAt) {
        account.startedAt = new Date().toISOString();
      }
      if (["completed", "skipped", "failed"].includes(account.status)) {
        account.completedAt = new Date().toISOString();
      }

      job.summary = summarize(job.accounts);
      job.updatedAt = new Date().toISOString();
      return cloneJob(job);
    },

    logAccountStep(id, accountId, step, detail) {
      const job = getMutableJob(id);
      const account = job.accounts.find((item) => item.accountId === accountId);
      if (!account) {
        throw new Error(`Account is not part of job: ${accountId}`);
      }
      if (!account.logs) account.logs = [];
      account.logs.push({ timestamp: new Date().toISOString(), step, detail });
      account.message = step;
      job.updatedAt = new Date().toISOString();
      return cloneJob(job);
    }
  };
}

function summarize(accounts: Array<{ status: JobAccountStatus }>): JobSummary {
  return accounts.reduce<JobSummary>(
    (summary, account) => {
      summary[account.status] += 1;
      return summary;
    },
    { queued: 0, running: 0, completed: 0, skipped: 0, failed: 0 }
  );
}

function cloneJob(job: AutomationJob): AutomationJob {
  return JSON.parse(JSON.stringify(job)) as AutomationJob;
}
