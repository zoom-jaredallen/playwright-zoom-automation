export type WorkItemStatus =
  | "new"
  | "leased"
  | "running"
  | "succeeded"
  | "skipped"
  | "failed"
  | "retrying"
  | "deferred"
  | "abandoned"
  | "cancelled";

export type FailureCategory =
  | "application"
  | "authentication"
  | "business"
  | "network"
  | "selector"
  | "timeout"
  | "unknown";

export interface WorkItemHistoryEntry {
  timestamp: string;
  event: string;
  status: WorkItemStatus;
  message?: string;
  workerId?: string;
}

export interface WorkItemArtifactRef {
  type: "trace" | "screenshot" | "details" | "log" | "other";
  url: string;
  label?: string;
}

export interface WorkItem {
  id: string;
  jobId: string;
  accountId: string;
  workflowIds: string[];
  status: WorkItemStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  workerId?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
  error?: string;
  failureCategory?: FailureCategory;
  artifactRefs: WorkItemArtifactRef[];
  history: WorkItemHistoryEntry[];
}

export interface CreateWorkItemsInput {
  jobId: string;
  accountIds: string[];
  workflowIds: string[];
  maxAttempts: number;
  now?: string;
}

export interface ClaimWorkItemInput {
  workerId: string;
  leaseMs: number;
  now?: string;
  jobId?: string;
}

export interface MarkWorkItemFailureInput {
  error: string;
  retryable: boolean;
  retryDelayMs: number;
  category?: FailureCategory;
  now?: string;
}

export interface RequeueFailedInput {
  jobId: string;
  accountIds?: string[];
  now?: string;
}

export interface WorkItemFilter {
  jobId?: string;
  status?: WorkItemStatus | WorkItemStatus[];
}

export interface WorkItemStore {
  createWorkItems(input: CreateWorkItemsInput): WorkItem[];
  getWorkItem(id: string): WorkItem | undefined;
  findByJobAccount(jobId: string, accountId: string): WorkItem | undefined;
  listWorkItems(filter?: WorkItemFilter): WorkItem[];
  claimNext(input: ClaimWorkItemInput): WorkItem | undefined;
  markRunning(id: string, workerId: string, now?: string): WorkItem;
  markSucceeded(id: string, message?: string, artifactRefs?: WorkItemArtifactRef[], now?: string): WorkItem;
  markSkipped(id: string, message?: string, artifactRefs?: WorkItemArtifactRef[], now?: string): WorkItem;
  markFailed(id: string, input: MarkWorkItemFailureInput): WorkItem;
  markCancelled(id: string, message?: string, now?: string): WorkItem;
  releaseExpiredLeases(now?: string): WorkItem[];
  requeueFailed(input: RequeueFailedInput): WorkItem[];
}
