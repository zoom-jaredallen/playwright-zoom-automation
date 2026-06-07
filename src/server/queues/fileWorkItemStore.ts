import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  transitionExpiredLease,
  transitionToCancelled,
  transitionToFailed,
  transitionToLeased,
  transitionToRequeued,
  transitionToRunning,
  transitionToSkipped,
  transitionToSucceeded
} from "./workItemStateMachine.js";
import type {
  ClaimWorkItemInput,
  CreateWorkItemsInput,
  MarkWorkItemFailureInput,
  RequeueFailedInput,
  WorkItem,
  WorkItemArtifactRef,
  WorkItemFilter,
  WorkItemStatus,
  WorkItemStore
} from "./types.js";

export interface FileWorkItemStoreOptions {
  directory: string;
}

export function createFileWorkItemStore(options: FileWorkItemStoreOptions): WorkItemStore {
  const directory = path.resolve(options.directory);
  mkdirSync(directory, { recursive: true });
  const cache = new Map<string, WorkItem>();
  loadAll(directory, cache);

  const persist = (item: WorkItem): void => {
    cache.set(item.id, item);
    const target = itemPath(directory, item.id);
    const temp = `${target}.tmp`;
    writeFileSync(temp, `${JSON.stringify(item, null, 2)}\n`, "utf8");
    renameSync(temp, target);
  };

  const getMutable = (id: string): WorkItem => {
    const item = cache.get(id);
    if (!item) throw new Error(`Work item not found: ${id}`);
    return item;
  };

  return {
    createWorkItems(input: CreateWorkItemsInput): WorkItem[] {
      const now = input.now ?? new Date().toISOString();
      const existingKeys = new Set([...cache.values()].map((item) => jobAccountKey(item.jobId, item.accountId)));
      const items = input.accountIds
        .filter((accountId) => !existingKeys.has(jobAccountKey(input.jobId, accountId)))
        .map((accountId) => createWorkItem(input, accountId, now));

      for (const item of items) persist(item);
      return items.map(clone);
    },

    getWorkItem(id: string): WorkItem | undefined {
      const item = cache.get(id);
      return item ? clone(item) : undefined;
    },

    findByJobAccount(jobId: string, accountId: string): WorkItem | undefined {
      const item = [...cache.values()].find((candidate) => candidate.jobId === jobId && candidate.accountId === accountId);
      return item ? clone(item) : undefined;
    },

    listWorkItems(filter: WorkItemFilter = {}): WorkItem[] {
      return [...cache.values()]
        .filter((item) => matchesFilter(item, filter))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.accountId.localeCompare(b.accountId))
        .map(clone);
    },

    claimNext(input: ClaimWorkItemInput): WorkItem | undefined {
      const now = input.now ?? new Date().toISOString();
      this.releaseExpiredLeases(now);
      const item = [...cache.values()]
        .filter((candidate) => isClaimable(candidate, now) && (!input.jobId || candidate.jobId === input.jobId))
        .sort((a, b) => (a.nextAttemptAt ?? a.createdAt).localeCompare(b.nextAttemptAt ?? b.createdAt))
        .at(0);
      if (!item) return undefined;
      const next = transitionToLeased(item, input.workerId, input.leaseMs, now);
      persist(next);
      return clone(next);
    },

    markRunning(id: string, workerId: string, now?: string): WorkItem {
      const next = transitionToRunning(getMutable(id), workerId, now);
      persist(next);
      return clone(next);
    },

    markSucceeded(id: string, message?: string, artifactRefs?: WorkItemArtifactRef[], now?: string): WorkItem {
      const next = transitionToSucceeded(getMutable(id), message, artifactRefs, now);
      persist(next);
      return clone(next);
    },

    markSkipped(id: string, message?: string, artifactRefs?: WorkItemArtifactRef[], now?: string): WorkItem {
      const next = transitionToSkipped(getMutable(id), message, artifactRefs, now);
      persist(next);
      return clone(next);
    },

    markFailed(id: string, input: MarkWorkItemFailureInput): WorkItem {
      const next = transitionToFailed(getMutable(id), input);
      persist(next);
      return clone(next);
    },

    markCancelled(id: string, message?: string, now?: string): WorkItem {
      const next = transitionToCancelled(getMutable(id), message, now);
      persist(next);
      return clone(next);
    },

    releaseExpiredLeases(now = new Date().toISOString()): WorkItem[] {
      const released: WorkItem[] = [];
      for (const item of cache.values()) {
        const next = transitionExpiredLease(item, now);
        if (!next) continue;
        persist(next);
        released.push(clone(next));
      }
      return released;
    },

    requeueFailed(input: RequeueFailedInput): WorkItem[] {
      const now = input.now ?? new Date().toISOString();
      const accountIds = input.accountIds ? new Set(input.accountIds) : undefined;
      const requeued: WorkItem[] = [];
      for (const item of cache.values()) {
        if (item.jobId !== input.jobId) continue;
        if (accountIds && !accountIds.has(item.accountId)) continue;
        if (!["failed", "abandoned", "cancelled"].includes(item.status)) continue;
        const next = transitionToRequeued(item, now);
        persist(next);
        requeued.push(clone(next));
      }
      return requeued;
    }
  };
}

function createWorkItem(input: CreateWorkItemsInput, accountId: string, now: string): WorkItem {
  const item: WorkItem = {
    id: randomUUID(),
    jobId: input.jobId,
    accountId,
    workflowIds: [...input.workflowIds],
    status: "new",
    attempt: 0,
    maxAttempts: Math.max(1, input.maxAttempts),
    createdAt: now,
    updatedAt: now,
    artifactRefs: [],
    history: []
  };
  return {
    ...item,
    history: [{ timestamp: now, event: "created", status: "new", message: "Work item created" }]
  };
}

function loadAll(directory: string, cache: Map<string, WorkItem>): void {
  try {
    for (const file of readdirSync(directory)) {
      if (!file.endsWith(".json")) continue;
      try {
        const item = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as WorkItem;
        if (item.id) cache.set(item.id, item);
      } catch {
        // Ignore unreadable work item files; the job monitor can surface missing items separately.
      }
    }
  } catch {
    // Directory may not exist on first boot.
  }
}

function itemPath(directory: string, id: string): string {
  return path.join(directory, `${id}.json`);
}

function jobAccountKey(jobId: string, accountId: string): string {
  return `${jobId}:${accountId}`;
}

function matchesFilter(item: WorkItem, filter: WorkItemFilter): boolean {
  if (filter.jobId && item.jobId !== filter.jobId) return false;
  if (filter.status) {
    const statuses: WorkItemStatus[] = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!statuses.includes(item.status)) return false;
  }
  return true;
}

function isClaimable(item: WorkItem, now: string): boolean {
  if (!["new", "retrying", "deferred"].includes(item.status)) return false;
  if (!item.nextAttemptAt) return true;
  return Date.parse(item.nextAttemptAt) <= Date.parse(now);
}

function clone(item: WorkItem): WorkItem {
  return JSON.parse(JSON.stringify(item)) as WorkItem;
}
