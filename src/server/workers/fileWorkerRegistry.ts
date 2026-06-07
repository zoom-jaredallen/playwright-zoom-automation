import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MarkStaleOfflineInput, RegisterWorkerInput, WorkerRecord, WorkerRegistry } from "./types.js";

export function createFileWorkerRegistry(filePath: string): WorkerRegistry {
  const resolvedPath = path.resolve(filePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const workers = new Map<string, WorkerRecord>();
  for (const worker of loadWorkers(resolvedPath)) workers.set(worker.workerId, worker);

  const persist = (): void => {
    const temp = `${resolvedPath}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ workers: [...workers.values()] }, null, 2)}\n`, "utf8");
    renameSync(temp, resolvedPath);
  };

  return {
    register(input: RegisterWorkerInput): WorkerRecord {
      const now = input.now ?? new Date().toISOString();
      const existing = workers.get(input.workerId);
      const worker: WorkerRecord = {
        workerId: input.workerId,
        status: "online",
        labels: input.labels ?? existing?.labels ?? {},
        registeredAt: existing?.registeredAt ?? now,
        lastHeartbeatAt: now,
        currentWorkItemId: existing?.currentWorkItemId
      };
      workers.set(worker.workerId, worker);
      persist();
      return clone(worker);
    },

    heartbeat(workerId: string, now = new Date().toISOString()): WorkerRecord {
      const worker = requireWorker(workers, workerId);
      const next = { ...worker, status: worker.status === "offline" ? "online" : worker.status, lastHeartbeatAt: now };
      workers.set(workerId, next);
      persist();
      return clone(next);
    },

    get(workerId: string): WorkerRecord | undefined {
      const worker = workers.get(workerId);
      return worker ? clone(worker) : undefined;
    },

    list(): WorkerRecord[] {
      return [...workers.values()].sort((a, b) => a.workerId.localeCompare(b.workerId)).map(clone);
    },

    markBusy(workerId: string, workItemId: string, now = new Date().toISOString()): WorkerRecord {
      const worker = requireWorker(workers, workerId);
      const next = { ...worker, status: "online" as const, currentWorkItemId: workItemId, lastHeartbeatAt: now };
      workers.set(workerId, next);
      persist();
      return clone(next);
    },

    markIdle(workerId: string, now = new Date().toISOString()): WorkerRecord {
      const worker = requireWorker(workers, workerId);
      const next = { ...worker, currentWorkItemId: undefined, lastHeartbeatAt: now };
      workers.set(workerId, next);
      persist();
      return clone(next);
    },

    markStaleOffline(input: MarkStaleOfflineInput): WorkerRecord[] {
      const now = Date.parse(input.now ?? new Date().toISOString());
      const expired: WorkerRecord[] = [];
      for (const worker of workers.values()) {
        if (worker.status === "offline") continue;
        if (now - Date.parse(worker.lastHeartbeatAt) <= input.staleAfterMs) continue;
        const next = { ...worker, status: "offline" as const, currentWorkItemId: undefined };
        workers.set(worker.workerId, next);
        expired.push(clone(next));
      }
      if (expired.length > 0) persist();
      return expired;
    }
  };
}

function loadWorkers(filePath: string): WorkerRecord[] {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { workers?: WorkerRecord[] };
    return raw.workers ?? [];
  } catch {
    return [];
  }
}

function requireWorker(workers: Map<string, WorkerRecord>, workerId: string): WorkerRecord {
  const worker = workers.get(workerId);
  if (!worker) throw new Error(`Worker not registered: ${workerId}`);
  return worker;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
