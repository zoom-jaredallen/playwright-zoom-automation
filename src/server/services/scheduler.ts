/**
 * Scheduler Service — manages cron-based recurring automation runs.
 * Stores schedules in a JSON file and executes them via the job runner.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ScheduleDefinition {
  id: string;
  name: string;
  /** Cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am) */
  cron: string;
  /** Whether this schedule is active */
  enabled: boolean;
  /** Job configuration */
  jobConfig: {
    workflowIds: string[];
    addressProfile: string;
    accountFilters?: {
      ownerRange?: { from: string; to: string };
      ids?: string[];
      limit?: number;
    };
    dryRun: boolean;
    headless: boolean;
    concurrency: number;
    retryAttempts: number;
    retryBaseDelayMs: number;
    accountDelayMs: number;
  };
  /** Notification settings */
  notifications?: {
    onComplete?: boolean;
    onFailure?: boolean;
    webhookUrl?: string;
  };
  /** Metadata */
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: "completed" | "failed" | "cancelled";
  nextRunAt?: string;
}

export interface SchedulerStore {
  list(): ScheduleDefinition[];
  get(id: string): ScheduleDefinition | undefined;
  create(input: Omit<ScheduleDefinition, "id" | "createdAt" | "updatedAt">): ScheduleDefinition;
  update(id: string, patch: Partial<ScheduleDefinition>): ScheduleDefinition;
  delete(id: string): boolean;
  markRun(id: string, status: ScheduleDefinition["lastRunStatus"]): void;
}

export function createSchedulerStore(filePath: string): SchedulerStore {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let schedules = loadSchedules(filePath);

  function persist(): void {
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify({ schedules }, null, 2) + "\n", "utf8");
    renameSync(tempPath, filePath);
  }

  return {
    list() {
      return schedules.map((s) => ({ ...s }));
    },

    get(id) {
      return schedules.find((s) => s.id === id);
    },

    create(input) {
      const now = new Date().toISOString();
      const schedule: ScheduleDefinition = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        nextRunAt: calculateNextRun(input.cron)
      };
      schedules.push(schedule);
      persist();
      return { ...schedule };
    },

    update(id, patch) {
      const index = schedules.findIndex((s) => s.id === id);
      if (index < 0) throw new Error(`Schedule not found: ${id}`);
      schedules[index] = {
        ...schedules[index],
        ...patch,
        id, // Prevent ID override
        updatedAt: new Date().toISOString(),
        nextRunAt: patch.cron ? calculateNextRun(patch.cron) : schedules[index].nextRunAt
      };
      persist();
      return { ...schedules[index] };
    },

    delete(id) {
      const before = schedules.length;
      schedules = schedules.filter((s) => s.id !== id);
      if (schedules.length < before) {
        persist();
        return true;
      }
      return false;
    },

    markRun(id, status) {
      const schedule = schedules.find((s) => s.id === id);
      if (!schedule) return;
      schedule.lastRunAt = new Date().toISOString();
      schedule.lastRunStatus = status;
      schedule.nextRunAt = calculateNextRun(schedule.cron);
      schedule.updatedAt = new Date().toISOString();
      persist();
    }
  };
}

function loadSchedules(filePath: string): ScheduleDefinition[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as { schedules?: ScheduleDefinition[] };
    return data.schedules ?? [];
  } catch {
    return [];
  }
}

/**
 * Simple cron next-run calculator.
 * Supports: minute hour day-of-month month day-of-week
 * For a full implementation, use a library like `cron-parser`.
 */
function calculateNextRun(cron: string): string {
  // Simplified: just add the interval from now
  // In production, use cron-parser for accurate calculation
  const parts = cron.split(/\s+/);
  if (parts.length < 5) return new Date(Date.now() + 3600_000).toISOString();

  const minute = parts[0] === "*" ? 0 : parseInt(parts[0], 10);
  const hour = parts[1] === "*" ? new Date().getHours() : parseInt(parts[1], 10);

  // Guard against malformed fields (parseInt -> NaN would make an Invalid Date,
  // and .toISOString() on it throws).
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return new Date(Date.now() + 3600_000).toISOString();
  }

  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

/**
 * Cron tick checker — determines if a schedule should run now.
 * Call this every minute from the scheduler loop.
 */
export function shouldRunNow(cron: string, now: Date = new Date()): boolean {
  const parts = cron.split(/\s+/);
  if (parts.length < 5) return false;

  const [minuteSpec, hourSpec, daySpec, monthSpec, dowSpec] = parts;

  if (!matchesCronField(minuteSpec, now.getMinutes())) return false;
  if (!matchesCronField(hourSpec, now.getHours())) return false;
  if (!matchesCronField(daySpec, now.getDate())) return false;
  if (!matchesCronField(monthSpec, now.getMonth() + 1)) return false;
  if (!matchesCronField(dowSpec, now.getDay())) return false;

  return true;
}

function matchesCronField(spec: string, value: number): boolean {
  if (spec === "*") return true;

  // Handle ranges like "1-5"
  if (spec.includes("-")) {
    const [start, end] = spec.split("-").map(Number);
    return value >= start && value <= end;
  }

  // Handle lists like "1,3,5"
  if (spec.includes(",")) {
    return spec.split(",").map(Number).includes(value);
  }

  // Handle step like "*/5"
  if (spec.startsWith("*/")) {
    const step = parseInt(spec.slice(2), 10);
    return value % step === 0;
  }

  return parseInt(spec, 10) === value;
}
