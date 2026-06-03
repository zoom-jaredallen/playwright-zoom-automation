import type { AutomationJob } from "./inMemoryJobStore.js";

export type JobEventListener = (job: AutomationJob) => void;

export interface JobEventEmitter {
  /** Subscribe to updates for a specific job. Returns an unsubscribe function. */
  subscribe(jobId: string, listener: JobEventListener): () => void;
  /** Emit an update event for a job. */
  emit(job: AutomationJob): void;
}

export function createJobEventEmitter(): JobEventEmitter {
  const listeners = new Map<string, Set<JobEventListener>>();

  return {
    subscribe(jobId: string, listener: JobEventListener): () => void {
      if (!listeners.has(jobId)) {
        listeners.set(jobId, new Set());
      }
      listeners.get(jobId)!.add(listener);

      return () => {
        const jobListeners = listeners.get(jobId);
        if (jobListeners) {
          jobListeners.delete(listener);
          if (jobListeners.size === 0) {
            listeners.delete(jobId);
          }
        }
      };
    },

    emit(job: AutomationJob): void {
      const jobListeners = listeners.get(job.id);
      if (!jobListeners) {
        return;
      }
      for (const listener of jobListeners) {
        try {
          listener(job);
        } catch {
          // Don't let a bad listener crash the emitter
        }
      }
    }
  };
}
