import os from "node:os";
import path from "node:path";
import { createFileWorkItemStore } from "../server/queues/fileWorkItemStore.js";
import { createFileWorkerRegistry } from "../server/workers/fileWorkerRegistry.js";
import { createWorkerHeartbeatService } from "../server/workers/workerHeartbeatService.js";
import { createWorkerLeaseService } from "../server/workers/workerLeaseService.js";

const workerId = process.env.WORKER_ID ?? `${os.hostname()}-${process.pid}`;
const leaseMs = Number.parseInt(process.env.WORKER_LEASE_MS ?? "300000", 10);
const heartbeatMs = Number.parseInt(process.env.WORKER_HEARTBEAT_MS ?? "15000", 10);
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "5000", 10);
const workersPath = path.resolve(process.env.WORKER_REGISTRY_PATH ?? "output/workers.json");
const workItemsPath = path.resolve(process.env.WORK_ITEM_DIR ?? "output/work-items");

const workers = createFileWorkerRegistry(workersPath);
const workItems = createFileWorkItemStore({ directory: workItemsPath });
const leases = createWorkerLeaseService({ workers, workItems });
workers.register({ workerId, labels: { host: os.hostname(), pid: String(process.pid) } });
const stopHeartbeat = createWorkerHeartbeatService({
  registry: workers,
  intervalMs: heartbeatMs,
  staleAfterMs: Math.max(heartbeatMs * 4, leaseMs)
}).start(workerId);

function claimOnce(): void {
  const item = leases.claimNext(workerId, { leaseMs });
  if (!item) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), workerId, message: "No work item available" }));
    return;
  }
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    workerId,
    message: "Claimed work item",
    workItemId: item.id,
    jobId: item.jobId,
    accountId: item.accountId,
    workflowIds: item.workflowIds
  }));
}

if (process.env.WORKER_CLAIM_ONCE === "true") {
  claimOnce();
  stopHeartbeat();
} else {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), workerId, message: "Worker started" }));
  const timer = setInterval(claimOnce, pollMs);
  process.on("SIGINT", () => {
    clearInterval(timer);
    stopHeartbeat();
    process.exit(0);
  });
}
