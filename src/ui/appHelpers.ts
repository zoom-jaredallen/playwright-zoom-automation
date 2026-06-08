import type { JobView, SubAccountView } from "./api.js";

export type WizardStepId = "accounts" | "configure" | "run";

export function buildWizardSteps(input: {
  selectedCount: number;
  workflowCount: number;
  job: JobView | undefined;
}) {
  return [
    {
      id: "accounts" as const,
      label: "Select Accounts",
      sublabel: input.selectedCount > 0 ? `${input.selectedCount} selected` : undefined,
      enabled: true,
      complete: input.selectedCount > 0
    },
    {
      id: "configure" as const,
      label: "Configure",
      sublabel: input.workflowCount > 0 ? `${input.workflowCount} workflow${input.workflowCount > 1 ? "s" : ""}` : undefined,
      enabled: input.selectedCount > 0,
      complete: input.selectedCount > 0 && input.workflowCount > 0
    },
    {
      id: "run" as const,
      label: "Run",
      sublabel: input.job ? statusLabel(input.job.status) : undefined,
      enabled: input.selectedCount > 0 && input.workflowCount > 0,
      complete: Boolean(input.job && ["completed", "failed", "cancelled"].includes(input.job.status))
    }
  ];
}

export function mergeGlobalParameterValues(
  accounts: SubAccountView[],
  globalValues: Record<string, string>,
  perAccountValues: Record<string, Record<string, string>> | undefined
): Record<string, Record<string, string>> | undefined {
  const usableGlobals = Object.fromEntries(Object.entries(globalValues).filter(([, value]) => value.trim().length > 0));
  if (Object.keys(usableGlobals).length === 0 && !perAccountValues) return undefined;
  const merged: Record<string, Record<string, string>> = {};
  for (const account of accounts) {
    merged[account.id] = {
      ...usableGlobals,
      ...(perAccountValues?.[account.id] ?? {})
    };
  }
  return merged;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { queued: "Queued", running: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
  return labels[status] ?? status;
}
