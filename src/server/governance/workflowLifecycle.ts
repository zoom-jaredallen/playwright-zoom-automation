import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type WorkflowLifecycleStatus = "draft" | "validated" | "approved" | "published" | "deprecated" | "archived";
export type WorkflowKind = "builtin" | "recorded";

export interface WorkflowLifecycleHistoryEntry {
  timestamp: string;
  status: WorkflowLifecycleStatus;
  actor?: string;
  note?: string;
}

export interface WorkflowLifecycleRecord {
  workflowId: string;
  kind: WorkflowKind;
  status: WorkflowLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  history: WorkflowLifecycleHistoryEntry[];
}

export interface WorkflowLifecycleTransitionOptions {
  actor?: string;
  note?: string;
  now?: string;
}

export interface WorkflowLifecycleStore {
  list(): WorkflowLifecycleRecord[];
  get(workflowId: string): WorkflowLifecycleRecord | undefined;
  getOrCreate(workflowId: string, kind: WorkflowKind, initialStatus?: WorkflowLifecycleStatus): WorkflowLifecycleRecord;
  transition(workflowId: string, status: WorkflowLifecycleStatus, options?: WorkflowLifecycleTransitionOptions): WorkflowLifecycleRecord;
}

export function isLifecycleLiveRunnable(status: WorkflowLifecycleStatus | undefined): boolean {
  return status === "approved" || status === "published";
}

export function defaultLifecycleStatus(kind: WorkflowKind): WorkflowLifecycleStatus {
  return kind === "builtin" ? "published" : "draft";
}

export function createFileWorkflowLifecycleStore(filePath: string): WorkflowLifecycleStore {
  const resolvedPath = path.resolve(filePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const records = new Map<string, WorkflowLifecycleRecord>();
  for (const record of loadRecords(resolvedPath)) {
    records.set(record.workflowId, record);
  }

  const persist = (): void => {
    const payload = { workflows: [...records.values()].sort((a, b) => a.workflowId.localeCompare(b.workflowId)) };
    const temp = `${resolvedPath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(temp, resolvedPath);
  };

  return {
    list() {
      return [...records.values()].map(clone);
    },

    get(workflowId: string) {
      const record = records.get(workflowId);
      return record ? clone(record) : undefined;
    },

    getOrCreate(workflowId: string, kind: WorkflowKind, initialStatus = defaultLifecycleStatus(kind)) {
      const current = records.get(workflowId);
      if (current) return clone(current);
      const now = new Date().toISOString();
      const record: WorkflowLifecycleRecord = {
        workflowId,
        kind,
        status: initialStatus,
        createdAt: now,
        updatedAt: now,
        history: [{ timestamp: now, status: initialStatus, note: "Lifecycle record created" }]
      };
      records.set(workflowId, record);
      persist();
      return clone(record);
    },

    transition(workflowId: string, status: WorkflowLifecycleStatus, options: WorkflowLifecycleTransitionOptions = {}) {
      const current = records.get(workflowId);
      if (!current) throw new Error(`Workflow lifecycle record not found: ${workflowId}`);
      assertLifecycleTransition(current.status, status);
      const now = options.now ?? new Date().toISOString();
      const next: WorkflowLifecycleRecord = {
        ...current,
        status,
        updatedAt: now,
        history: [...current.history, { timestamp: now, status, actor: options.actor, note: options.note }]
      };
      records.set(workflowId, next);
      persist();
      return clone(next);
    }
  };
}

function assertLifecycleTransition(from: WorkflowLifecycleStatus, to: WorkflowLifecycleStatus): void {
  const allowed: Record<WorkflowLifecycleStatus, WorkflowLifecycleStatus[]> = {
    draft: ["validated", "archived"],
    validated: ["draft", "approved", "archived"],
    approved: ["published", "deprecated", "archived"],
    published: ["deprecated", "archived"],
    deprecated: ["archived", "published"],
    archived: []
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) {
    throw new Error(`Cannot transition workflow from ${from} to ${to}`);
  }
}

function loadRecords(filePath: string): WorkflowLifecycleRecord[] {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { workflows?: WorkflowLifecycleRecord[] };
    return raw.workflows ?? [];
  } catch {
    return [];
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
