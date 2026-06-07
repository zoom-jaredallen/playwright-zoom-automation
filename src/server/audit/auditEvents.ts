export type AuditEventType =
  | "workflow_imported"
  | "workflow_validated"
  | "workflow_approved"
  | "workflow_published"
  | "live_run_started"
  | "work_item_retried"
  | "credential_accessed"
  | "run_cancelled"
  | "artifact_accessed";

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actor?: string;
  jobId?: string;
  workflowId?: string;
  accountId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type CreateAuditEventInput = Omit<AuditEvent, "id" | "timestamp"> & {
  timestamp?: string;
};
