import type { WorkItem } from "../queues/types.js";
import type { ArtifactView } from "../services/artifacts.js";
import type { AutomationJob } from "../services/inMemoryJobStore.js";

export interface RunManifestInput {
  job: AutomationJob;
  workItems: WorkItem[];
  artifacts: ArtifactView[];
}

export interface RunManifest {
  generatedAt: string;
  jobId: string;
  status: AutomationJob["status"];
  dryRun: boolean;
  workflowIds: string[];
  addressProfile: string;
  accounts: Array<{
    accountId: string;
    status: WorkItem["status"];
    failureCategory?: WorkItem["failureCategory"];
  }>;
  artifacts: ArtifactView[];
}

export function createRunManifest(input: RunManifestInput): RunManifest {
  return {
    generatedAt: new Date().toISOString(),
    jobId: input.job.id,
    status: input.job.status,
    dryRun: input.job.input.dryRun,
    workflowIds: [...input.job.input.workflowIds],
    addressProfile: input.job.input.addressProfile,
    accounts: input.workItems.map((item) => ({
      accountId: item.accountId,
      status: item.status,
      failureCategory: item.failureCategory
    })),
    artifacts: [...input.artifacts]
  };
}
