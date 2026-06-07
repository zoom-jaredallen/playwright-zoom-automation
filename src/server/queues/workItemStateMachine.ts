import type {
  FailureCategory,
  MarkWorkItemFailureInput,
  WorkItem,
  WorkItemArtifactRef,
  WorkItemHistoryEntry,
  WorkItemStatus
} from "./types.js";

export function transitionToLeased(item: WorkItem, workerId: string, leaseMs: number, now = new Date().toISOString()): WorkItem {
  assertTransition(item.status, ["new", "retrying", "deferred"], "leased");
  const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
  return withHistory({
    ...item,
    status: "leased",
    attempt: item.attempt + 1,
    workerId,
    leaseExpiresAt,
    nextAttemptAt: undefined,
    updatedAt: now
  }, now, "leased", `Leased to ${workerId}`, workerId);
}

export function transitionToRunning(item: WorkItem, workerId: string, now = new Date().toISOString()): WorkItem {
  assertTransition(item.status, ["leased", "new", "retrying"], "running");
  return withHistory({
    ...item,
    status: "running",
    workerId,
    startedAt: item.startedAt ?? now,
    leaseExpiresAt: item.leaseExpiresAt,
    updatedAt: now
  }, now, "running", `Running on ${workerId}`, workerId);
}

export function transitionToSucceeded(
  item: WorkItem,
  message?: string,
  artifactRefs: WorkItemArtifactRef[] = [],
  now = new Date().toISOString()
): WorkItem {
  assertTransition(item.status, ["leased", "running", "retrying", "new"], "succeeded");
  return withHistory({
    ...item,
    status: "succeeded",
    message,
    artifactRefs: mergeArtifacts(item.artifactRefs, artifactRefs),
    leaseExpiresAt: undefined,
    workerId: undefined,
    completedAt: now,
    updatedAt: now
  }, now, "succeeded", message);
}

export function transitionToSkipped(
  item: WorkItem,
  message?: string,
  artifactRefs: WorkItemArtifactRef[] = [],
  now = new Date().toISOString()
): WorkItem {
  assertTransition(item.status, ["leased", "running", "retrying", "new"], "skipped");
  return withHistory({
    ...item,
    status: "skipped",
    message,
    artifactRefs: mergeArtifacts(item.artifactRefs, artifactRefs),
    leaseExpiresAt: undefined,
    workerId: undefined,
    completedAt: now,
    updatedAt: now
  }, now, "skipped", message);
}

export function transitionToFailed(item: WorkItem, input: MarkWorkItemFailureInput): WorkItem {
  assertTransition(item.status, ["leased", "running", "retrying", "new"], "failed");
  const now = input.now ?? new Date().toISOString();
  const shouldRetry = input.retryable && item.attempt < item.maxAttempts;
  const status: WorkItemStatus = shouldRetry ? "retrying" : "failed";
  const nextAttemptAt = shouldRetry ? new Date(Date.parse(now) + input.retryDelayMs).toISOString() : undefined;

  return withHistory({
    ...item,
    status,
    error: input.error,
    failureCategory: input.category ?? categorizeFailure(input.error),
    nextAttemptAt,
    leaseExpiresAt: undefined,
    workerId: undefined,
    completedAt: status === "failed" ? now : undefined,
    updatedAt: now
  }, now, status, input.error);
}

export function transitionToCancelled(item: WorkItem, message?: string, now = new Date().toISOString()): WorkItem {
  if (["succeeded", "skipped", "failed", "abandoned", "cancelled"].includes(item.status)) {
    throw new Error(`Cannot transition work item ${item.id} from ${item.status} to cancelled`);
  }
  return withHistory({
    ...item,
    status: "cancelled",
    message,
    leaseExpiresAt: undefined,
    workerId: undefined,
    completedAt: now,
    updatedAt: now
  }, now, "cancelled", message);
}

export function transitionExpiredLease(item: WorkItem, now = new Date().toISOString()): WorkItem | undefined {
  if (!["leased", "running"].includes(item.status)) return undefined;
  if (!item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) > Date.parse(now)) return undefined;

  const status: WorkItemStatus = item.attempt < item.maxAttempts ? "retrying" : "abandoned";
  return withHistory({
    ...item,
    status,
    error: status === "abandoned" ? "Lease expired after maximum attempts" : item.error,
    failureCategory: status === "abandoned" ? "unknown" : item.failureCategory,
    workerId: undefined,
    leaseExpiresAt: undefined,
    completedAt: status === "abandoned" ? now : undefined,
    updatedAt: now
  }, now, status, "Lease expired");
}

export function transitionToRequeued(item: WorkItem, now = new Date().toISOString()): WorkItem {
  if (!["failed", "abandoned", "cancelled"].includes(item.status)) {
    throw new Error(`Cannot requeue work item ${item.id} from ${item.status}`);
  }
  return withHistory({
    ...item,
    status: "new",
    attempt: 0,
    nextAttemptAt: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
    startedAt: undefined,
    completedAt: undefined,
    message: undefined,
    error: undefined,
    failureCategory: undefined,
    updatedAt: now
  }, now, "requeued", "Requeued failed work item");
}

function assertTransition(from: WorkItemStatus, allowed: WorkItemStatus[], to: WorkItemStatus): void {
  if (!allowed.includes(from)) {
    throw new Error(`Cannot transition work item from ${from} to ${to}`);
  }
}

function withHistory(item: WorkItem, timestamp: string, event: string, message?: string, workerId?: string): WorkItem {
  const entry: WorkItemHistoryEntry = { timestamp, event, status: item.status, message, workerId };
  return { ...item, history: [...item.history, entry] };
}

function mergeArtifacts(existing: WorkItemArtifactRef[], next: WorkItemArtifactRef[]): WorkItemArtifactRef[] {
  const seen = new Set<string>();
  return [...existing, ...next].filter((artifact) => {
    const key = `${artifact.type}:${artifact.url}:${artifact.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categorizeFailure(error: string): FailureCategory {
  const message = error.toLowerCase();
  if (message.includes("timeout")) return "timeout";
  if (message.includes("selector") || message.includes("locator")) return "selector";
  if (message.includes("sign-in") || message.includes("captcha") || message.includes("authentication")) return "authentication";
  if (message.includes("net::") || message.includes("temporarily unavailable")) return "network";
  return "unknown";
}
