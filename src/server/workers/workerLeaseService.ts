import type { WorkItem, WorkItemStore } from "../queues/types.js";
import type { WorkerRegistry } from "./types.js";

export interface WorkerLeaseServiceOptions {
  workItems: WorkItemStore;
  workers: WorkerRegistry;
}

export interface ClaimOptions {
  leaseMs: number;
  now?: string;
  jobId?: string;
}

export interface WorkerLeaseService {
  claimNext(workerId: string, options: ClaimOptions): WorkItem | undefined;
  complete(workerId: string, workItemId: string, message?: string, now?: string): WorkItem;
  fail(workerId: string, workItemId: string, error: string, retryable: boolean, now?: string): WorkItem;
}

export function createWorkerLeaseService(options: WorkerLeaseServiceOptions): WorkerLeaseService {
  return {
    claimNext(workerId, claimOptions) {
      const worker = options.workers.get(workerId);
      if (!worker || worker.status === "offline") {
        throw new Error(`Worker is not available: ${workerId}`);
      }
      options.workers.heartbeat(workerId, claimOptions.now);
      const item = options.workItems.claimNext({
        workerId,
        leaseMs: claimOptions.leaseMs,
        now: claimOptions.now,
        jobId: claimOptions.jobId
      });
      if (item) options.workers.markBusy(workerId, item.id, claimOptions.now);
      return item;
    },

    complete(workerId, workItemId, message, now) {
      const item = options.workItems.markSucceeded(workItemId, message, [], now);
      options.workers.markIdle(workerId, now);
      return item;
    },

    fail(workerId, workItemId, error, retryable, now) {
      const item = options.workItems.markFailed(workItemId, {
        error,
        retryable,
        retryDelayMs: 5_000,
        now
      });
      options.workers.markIdle(workerId, now);
      return item;
    }
  };
}
