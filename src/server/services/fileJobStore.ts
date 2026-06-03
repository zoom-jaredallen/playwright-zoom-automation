import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutomationJob,
  CreateJobInput,
  JobAccountState,
  JobAccountStatus,
  JobStatus,
  JobStore,
  JobSummary
} from "./inMemoryJobStore.js";
import type { JobEventEmitter } from "./jobEvents.js";

export interface FileJobStoreOptions {
  /** Directory where job JSON files are stored. Defaults to "output/jobs". */
  directory: string;
  /** Maximum number of jobs to keep in memory cache. Defaults to 50. */
  maxCacheSize?: number;
  /** Optional event emitter for real-time job update notifications. */
  events?: JobEventEmitter;
}

/**
 * A file-backed job store that persists each job as a separate JSON file.
 * Jobs survive server restarts. The store maintains an in-memory cache for
 * fast reads and writes through to disk on every mutation.
 */
export function createFileJobStore(options: FileJobStoreOptions): JobStore {
  const { directory, maxCacheSize = 50, events } = options;
  mkdirSync(directory, { recursive: true });

  const cache = new Map<string, AutomationJob>();
  loadExistingJobs(directory, cache, maxCacheSize);

  const persist = (job: AutomationJob): void => {
    const filePath = path.join(directory, `${job.id}.json`);
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    renameSync(tempPath, filePath);
    events?.emit(job);
  };

  const getMutableJob = (id: string): AutomationJob => {
    const job = cache.get(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }
    return job;
  };

  return {
    createJob(input: CreateJobInput): AutomationJob {
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
      cache.set(job.id, job);
      persist(job);
      evictOldest(cache, maxCacheSize);
      return cloneJob(job);
    },

    getJob(id: string): AutomationJob | undefined {
      const cached = cache.get(id);
      if (cached) {
        return cloneJob(cached);
      }
      // Try loading from disk if not in cache
      const loaded = loadJobFromDisk(directory, id);
      if (loaded) {
        cache.set(id, loaded);
        evictOldest(cache, maxCacheSize);
        return cloneJob(loaded);
      }
      return undefined;
    },

    listJobs(): AutomationJob[] {
      return Array.from(cache.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(cloneJob);
    },

    markJob(id: string, status: JobStatus, message?: string): AutomationJob {
      const job = getMutableJob(id);
      const now = new Date().toISOString();
      job.status = status;
      job.updatedAt = now;
      if (message) {
        job.events.push({ timestamp: now, message });
      }
      persist(job);
      return cloneJob(job);
    },

    markAccount(id: string, accountId: string, patch: Partial<JobAccountState>): AutomationJob {
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
      persist(job);
      return cloneJob(job);
    },

    logAccountStep(id: string, accountId: string, step: string, detail?: string): AutomationJob {
      const job = getMutableJob(id);
      const account = job.accounts.find((item) => item.accountId === accountId);
      if (!account) {
        throw new Error(`Account is not part of job: ${accountId}`);
      }
      if (!account.logs) account.logs = [];
      account.logs.push({ timestamp: new Date().toISOString(), step, detail });
      account.message = step;
      job.updatedAt = new Date().toISOString();
      persist(job);
      return cloneJob(job);
    }
  };
}

function loadExistingJobs(directory: string, cache: Map<string, AutomationJob>, maxCacheSize: number): void {
  try {
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".json") && !file.endsWith(".tmp"))
      .sort()
      .reverse()
      .slice(0, maxCacheSize);

    for (const file of files) {
      try {
        const raw = readFileSync(path.join(directory, file), "utf8");
        const job = JSON.parse(raw) as AutomationJob;
        if (job.id) {
          cache.set(job.id, job);
        }
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // Directory may not exist yet or be empty
  }
}

function loadJobFromDisk(directory: string, id: string): AutomationJob | undefined {
  try {
    const filePath = path.join(directory, `${id}.json`);
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as AutomationJob;
  } catch {
    return undefined;
  }
}

function evictOldest(cache: Map<string, AutomationJob>, maxSize: number): void {
  if (cache.size <= maxSize) {
    return;
  }
  const sorted = Array.from(cache.entries()).sort(
    ([, a], [, b]) => a.createdAt.localeCompare(b.createdAt)
  );
  const toRemove = sorted.slice(0, cache.size - maxSize);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
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
