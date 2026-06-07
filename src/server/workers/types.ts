export type WorkerStatus = "online" | "offline" | "draining";

export interface WorkerRecord {
  workerId: string;
  status: WorkerStatus;
  labels: Record<string, string>;
  registeredAt: string;
  lastHeartbeatAt: string;
  currentWorkItemId?: string;
}

export interface RegisterWorkerInput {
  workerId: string;
  labels?: Record<string, string>;
  now?: string;
}

export interface MarkStaleOfflineInput {
  now?: string;
  staleAfterMs: number;
}

export interface WorkerRegistry {
  register(input: RegisterWorkerInput): WorkerRecord;
  heartbeat(workerId: string, now?: string): WorkerRecord;
  get(workerId: string): WorkerRecord | undefined;
  list(): WorkerRecord[];
  markBusy(workerId: string, workItemId: string, now?: string): WorkerRecord;
  markIdle(workerId: string, now?: string): WorkerRecord;
  markStaleOffline(input: MarkStaleOfflineInput): WorkerRecord[];
}
