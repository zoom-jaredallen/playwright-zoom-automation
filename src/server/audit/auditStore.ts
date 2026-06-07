import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AuditEvent, CreateAuditEventInput } from "./auditEvents.js";

export interface AuditEventFilter {
  jobId?: string;
  workflowId?: string;
  eventType?: AuditEvent["eventType"];
}

export interface AuditStore {
  append(input: CreateAuditEventInput): AuditEvent;
  list(filter?: AuditEventFilter): AuditEvent[];
}

export function createFileAuditStore(filePath: string): AuditStore {
  const resolvedPath = path.resolve(filePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });

  return {
    append(input: CreateAuditEventInput): AuditEvent {
      const event: AuditEvent = {
        id: randomUUID(),
        timestamp: input.timestamp ?? new Date().toISOString(),
        eventType: input.eventType,
        actor: input.actor,
        jobId: input.jobId,
        workflowId: input.workflowId,
        accountId: input.accountId,
        message: input.message,
        metadata: input.metadata
      };
      appendFileSync(resolvedPath, `${JSON.stringify(event)}\n`, "utf8");
      return clone(event);
    },

    list(filter: AuditEventFilter = {}): AuditEvent[] {
      return readEvents(resolvedPath)
        .filter((event) => !filter.jobId || event.jobId === filter.jobId)
        .filter((event) => !filter.workflowId || event.workflowId === filter.workflowId)
        .filter((event) => !filter.eventType || event.eventType === filter.eventType)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map(clone);
    }
  };
}

function readEvents(filePath: string): AuditEvent[] {
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
