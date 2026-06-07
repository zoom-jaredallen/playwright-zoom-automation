import type { SubAccount } from "../../automation/types.js";
import type { WorkflowParameter } from "@zoom-automation/workflow-core";
import { isLifecycleLiveRunnable, type WorkflowLifecycleStatus } from "../governance/workflowLifecycle.js";

export type ReadinessSeverity = "pass" | "warning" | "blocking";

export interface ReadinessCheck {
  id: string;
  label: string;
  severity: ReadinessSeverity;
  message: string;
}

export interface RequiredDocumentCheck {
  label: string;
  path?: string;
  required: boolean;
}

export interface RunReadinessInput {
  selectedAccounts: SubAccount[];
  workflowIds: string[];
  enabledWorkflowIds: Set<string>;
  workflows?: Array<{ id: string; name: string; lifecycleStatus?: WorkflowLifecycleStatus }>;
  addressProfile?: string;
  dryRun: boolean;
  requiredDocuments: RequiredDocumentCheck[];
  parameters: Pick<WorkflowParameter, "name" | "required">[];
  parameterValues: Record<string, string | undefined>;
}

export interface RunReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  blocking: ReadinessCheck[];
  warnings: ReadinessCheck[];
}

export function evaluateRunReadiness(input: RunReadinessInput): RunReadinessResult {
  const checks: ReadinessCheck[] = [
    input.selectedAccounts.length > 0
      ? pass("accounts", "Accounts", `${input.selectedAccounts.length} account(s) selected`)
      : block("accounts", "Accounts", "Select at least one sub account"),
    input.workflowIds.length > 0 && input.workflowIds.every((id) => input.enabledWorkflowIds.has(id))
      ? pass("workflows", "Workflows", `${input.workflowIds.length} workflow(s) ready`)
      : block("workflows", "Workflows", "Select enabled workflows before starting"),
    input.addressProfile
      ? pass("address-profile", "Address profile", input.addressProfile)
      : block("address-profile", "Address profile", "Select an address profile")
  ];

  const missingDocuments = input.requiredDocuments.filter((document) => document.required && !document.path);
  checks.push(missingDocuments.length === 0
    ? pass("documents", "Documents", "Required documents are configured")
    : block("documents", "Documents", `Missing ${missingDocuments.map((document) => document.label).join(", ")}`));

  const missingParameters = input.parameters.filter((parameter) => parameter.required && !input.parameterValues[parameter.name]);
  checks.push(missingParameters.length === 0
    ? pass("parameters", "Workflow parameters", "Required parameters are complete")
    : block("parameters", "Workflow parameters", `Missing ${missingParameters.map((parameter) => parameter.name).join(", ")}`));

  if (!input.dryRun) {
    checks.push({
      id: "live-mode",
      label: "Live mode",
      severity: "warning",
      message: "This run will make changes in Zoom"
    });
    const unsafeWorkflows = (input.workflows ?? [])
      .filter((workflow) => input.workflowIds.includes(workflow.id))
      .filter((workflow) => !isLifecycleLiveRunnable(workflow.lifecycleStatus));
    checks.push(unsafeWorkflows.length === 0
      ? pass("workflow-lifecycle", "Workflow lifecycle", "Selected workflows are approved for live runs")
      : block(
          "workflow-lifecycle",
          "Workflow lifecycle",
          `Live runs require approved or published workflows: ${unsafeWorkflows.map((workflow) => workflow.name).join(", ")}`
        ));
  } else {
    checks.push(pass("dry-run", "Dry run", "Run is configured as a dry run"));
  }

  const blocking = checks.filter((check) => check.severity === "blocking");
  const warnings = checks.filter((check) => check.severity === "warning");
  return { ready: blocking.length === 0, checks, blocking, warnings };
}

function pass(id: string, label: string, message: string): ReadinessCheck {
  return { id, label, severity: "pass", message };
}

function block(id: string, label: string, message: string): ReadinessCheck {
  return { id, label, severity: "blocking", message };
}
