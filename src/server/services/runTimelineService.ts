import type { AccountLogEntry, JobAccountState, JobStore } from "./inMemoryJobStore.js";

export type StructuredAccountLogInput = Omit<AccountLogEntry, "timestamp" | "step" | "detail"> & {
  message: string;
  detail?: string;
};

export interface AccountTimeline {
  entries: AccountLogEntry[];
  currentStep?: AccountLogEntry;
  lastSuccessfulStep?: AccountLogEntry;
  failedStep?: AccountLogEntry;
}

export function appendStructuredAccountLog(
  store: JobStore,
  jobId: string,
  accountId: string,
  input: StructuredAccountLogInput
): void {
  store.logAccountStep(jobId, accountId, input.message, input.detail, {
    workflowId: input.workflowId,
    stepId: input.stepId,
    stepName: input.stepName,
    level: input.level,
    artifactRefs: input.artifactRefs
  });
}

export function deriveAccountTimeline(account: Pick<JobAccountState, "logs">): AccountTimeline {
  const entries = account.logs ?? [];
  const structured = entries.filter((entry) => entry.level || entry.stepId || entry.stepName);
  const currentStep = [...structured].reverse().find((entry) => entry.level !== "success") ?? entries.at(-1);
  const lastSuccessfulStep = [...structured].reverse().find((entry) => entry.level === "success");
  const failedStep = [...structured].reverse().find((entry) => entry.level === "error");
  return { entries, currentStep, lastSuccessfulStep, failedStep };
}
