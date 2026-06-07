import type { WorkerRegistry } from "./types.js";

export interface WorkerHeartbeatService {
  start(workerId: string): () => void;
}

export function createWorkerHeartbeatService(options: {
  registry: WorkerRegistry;
  intervalMs: number;
  staleAfterMs: number;
}): WorkerHeartbeatService {
  return {
    start(workerId: string): () => void {
      const tick = () => {
        options.registry.heartbeat(workerId);
        options.registry.markStaleOffline({ staleAfterMs: options.staleAfterMs });
      };
      tick();
      const timer = setInterval(tick, options.intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    }
  };
}
