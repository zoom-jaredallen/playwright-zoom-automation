export interface SubAccountView {
  id: string;
  name: string;
  ownerEmail?: string;
  ownerName?: string;
}

export interface AddressProfileView {
  id: string;
  country: string;
  numberType: string;
  customerName: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
  };
  documentsRequired: boolean;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: WorkflowCategory;
}

export interface AccountCohortView {
  id: string;
  name: string;
  accountIds: string[];
  filters?: AccountQueryFilters;
  createdAt: string;
  updatedAt: string;
}

export interface JobView {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  input: {
    accountIds: string[];
    workflowIds: string[];
    dryRun: boolean;
    addressProfile: string;
  };
  accounts: Array<{
    accountId: string;
    workflowId?: string;
    status: "queued" | "running" | "completed" | "skipped" | "failed";
    message?: string;
    error?: string;
    logs?: Array<{
      timestamp: string;
      step: string;
      detail?: string;
      workflowId?: string;
      stepId?: string;
      stepName?: string;
      level?: "info" | "success" | "warning" | "error";
      artifactRefs?: Array<{ type: "trace" | "screenshot" | "details" | "log" | "other"; url: string; label?: string }>;
    }>;
  }>;
  summary: {
    queued: number;
    running: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  events: Array<{
    timestamp: string;
    message: string;
  }>;
}

export interface ArtifactView {
  name: string;
  type: "trace" | "screenshot" | "details" | "log" | "other";
  sizeBytes: number;
  modifiedAt: string;
  url: string;
  downloadUrl: string;
}

export interface ReadinessCheckView {
  id: string;
  label: string;
  severity: "pass" | "warning" | "blocking";
  message: string;
}

export interface RunReadinessView {
  ready: boolean;
  checks: ReadinessCheckView[];
  blocking: ReadinessCheckView[];
  warnings: ReadinessCheckView[];
}

// ─── Recorded Workflow Types (for Editor) ────────────────────────────────────
// These come from the shared `@zoom-automation/workflow-core` package so the Web
// UI, server, compiler, and Chrome extension all share one schema. The `*View`
// aliases preserve the existing import names used across the UI components.

import type {
  RecordedAction,
  RecordedWorkflow,
  WorkflowCategory,
  WorkflowQualityReport
} from "@zoom-automation/workflow-core";

export type RecordedActionView = RecordedAction;
export type RecordedWorkflowView = RecordedWorkflow;
export type WorkflowQualityReportView = WorkflowQualityReport;

export async function fetchRecordedWorkflows(): Promise<{ workflows: Array<{ id: string; name: string; category: string; actionCount: number }> }> {
  return requestJson("/api/workflows/recorded");
}

export async function fetchRecordedWorkflow(id: string): Promise<{ workflow: RecordedWorkflowView }> {
  return requestJson(`/api/workflows/recorded/${id}`);
}

export async function saveRecordedWorkflow(id: string, workflow: RecordedWorkflowView): Promise<{ ok: boolean }> {
  return requestJson(`/api/workflows/recorded/${id}`, {
    method: "PUT",
    body: JSON.stringify({ workflow })
  });
}

export async function duplicateRecordedWorkflow(id: string, name: string): Promise<{ id: string; name: string }> {
  return requestJson(`/api/workflows/recorded/${id}/duplicate`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

// ─── Account Query Types ─────────────────────────────────────────────────────

export interface AccountQueryFilters {
  ownerRange?: {
    from: string;
    to: string;
  };
  search?: string;
  limit?: number;
}

export async function fetchAddressProfiles(): Promise<{
  selectedProfile: string;
  adminEmail: string;
  profiles: AddressProfileView[];
}> {
  return requestJson("/api/address-profiles");
}

export async function fetchWorkflows(): Promise<{ workflows: WorkflowView[] }> {
  return requestJson("/api/workflows");
}

export async function queryAccounts(filters: AccountQueryFilters): Promise<{
  total: number;
  count: number;
  accounts: SubAccountView[];
}> {
  return requestJson("/api/accounts/query", {
    method: "POST",
    body: JSON.stringify({ filters })
  });
}

export async function fetchCohorts(): Promise<{ cohorts: AccountCohortView[] }> {
  return requestJson("/api/cohorts");
}

export async function createCohort(input: {
  name: string;
  accountIds: string[];
  filters?: AccountQueryFilters;
}): Promise<{ cohort: AccountCohortView }> {
  return requestJson("/api/cohorts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteCohort(id: string): Promise<{ ok: boolean }> {
  return requestJson(`/api/cohorts/${id}`, { method: "DELETE" });
}

export async function createJob(input: {
  accounts: SubAccountView[];
  accountIds: string[];
  workflowIds: string[];
  addressProfile: string;
  dryRun: boolean;
  headless: boolean;
  concurrency?: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  accountDelayMs: number;
  accountValues?: Record<string, Record<string, string>>;
}): Promise<{ job: JobView }> {
  return requestJson("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function checkRunReadiness(input: {
  accounts: SubAccountView[];
  workflowIds: string[];
  addressProfile: string;
  dryRun: boolean;
  parameterValues?: Record<string, string>;
}): Promise<{ readiness: RunReadinessView }> {
  return requestJson("/api/readiness/check", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchJobs(): Promise<{ jobs: JobView[] }> {
  return requestJson("/api/jobs");
}

export async function fetchJob(jobId: string): Promise<{ job: JobView }> {
  return requestJson(`/api/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<{ job: JobView }> {
  return requestJson(`/api/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function retryJob(input: {
  jobId: string;
  accounts: SubAccountView[];
  statuses: Array<"failed" | "skipped">;
  dryRun?: boolean;
  headless?: boolean;
  concurrency?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  accountDelayMs?: number;
  addressProfile?: string;
}): Promise<{ job: JobView }> {
  const { jobId, ...body } = input;
  return requestJson(`/api/jobs/${jobId}/retry`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function fetchJobArtifacts(jobId: string, accountId?: string): Promise<{ artifacts: ArtifactView[] }> {
  const params = new URLSearchParams();
  if (accountId) params.set("accountId", accountId);
  const query = params.toString();
  return requestJson(`/api/jobs/${jobId}/artifacts${query ? `?${query}` : ""}`);
}

/**
 * Subscribe to real-time job updates via Server-Sent Events.
 * Returns an unsubscribe function to close the connection.
 */
export function subscribeToJob(
  jobId: string,
  onUpdate: (job: JobView) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { job: JobView };
      onUpdate(data.job);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  eventSource.onerror = () => {
    // EventSource auto-reconnects on transient errors.
    // Only report if the connection is fully closed.
    if (eventSource.readyState === EventSource.CLOSED) {
      onError?.(new Error("Job stream connection closed"));
    }
  };

  return () => {
    eventSource.close();
  };
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body;
}
