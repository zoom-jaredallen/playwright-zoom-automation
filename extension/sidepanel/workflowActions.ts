import { createPublishReview } from "../shared/publishReview.js";
import type { ExtensionMessage, RecordedWorkflow, SelectorTestResult } from "../shared/types.js";
import { calculateQualityReport } from "./qualityUtils.js";
import { formatError, parseWorkflowJson, slugify } from "./workflowFileUtils.js";

export interface WorkflowActionDeps {
  workflowImportFileInput: HTMLInputElement;
  workflowNameInput: HTMLInputElement;
  workflowCategorySelect: HTMLSelectElement;
  currentWorkflow: RecordedWorkflow | undefined;
  sendMessage(message: ExtensionMessage): Promise<any>;
  getServerUrl(): Promise<string>;
  refreshState(): Promise<void>;
  setMessage(message: string): void;
  setCurrentWorkflow(workflow: RecordedWorkflow | undefined): void;
  setWorkflowDetailsHydrated(value: boolean): void;
  setSelectedActionId(actionId: string | undefined): void;
  setInsertAfterActionId(actionId: string | null | undefined): void;
  setSelectorTestResults(results: Record<string, SelectorTestResult>): void;
  setStepTestResults(results: Record<string, { level: "success" | "error" | "info"; message: string }>): void;
}

export async function copyWorkflow(deps: WorkflowActionDeps): Promise<void> {
  const workflow = await buildWorkflow(deps);
  await navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
  deps.setMessage("Workflow JSON copied.");
}

export async function downloadWorkflow(deps: WorkflowActionDeps): Promise<void> {
  const workflow = await buildWorkflow(deps);
  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(workflow.meta.name || "workflow")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  deps.setMessage("Workflow JSON downloaded.");
}

export async function importWorkflowFromFile(deps: WorkflowActionDeps): Promise<void> {
  const file = deps.workflowImportFileInput.files?.[0];
  deps.workflowImportFileInput.value = "";
  if (!file) return;

  try {
    const workflow = parseWorkflowJson(await file.text());
    const response = await deps.sendMessage({ type: "IMPORT_WORKFLOW", workflow });
    if (!response?.ok) {
      deps.setMessage(`Import failed: ${response?.error ?? "Unknown error"}`);
      return;
    }

    deps.setCurrentWorkflow(workflow);
    deps.setWorkflowDetailsHydrated(true);
    deps.setSelectedActionId(workflow.actions[0]?.id);
    deps.setInsertAfterActionId(undefined);
    deps.setSelectorTestResults({});
    deps.setStepTestResults({});
    hydrateWorkflowDetails(deps, workflow, { force: true });
    deps.setMessage(`Imported "${workflow.meta.name || file.name}" with ${workflow.actions.length} step(s).`);
    await deps.refreshState();
  } catch (error) {
    deps.setMessage(`Import failed: ${formatError(error)}`);
  }
}

export function hydrateWorkflowDetails(deps: Pick<WorkflowActionDeps, "workflowNameInput" | "workflowCategorySelect">, workflow: RecordedWorkflow, options: { force?: boolean } = {}): void {
  if (options.force || !deps.workflowNameInput.value) {
    deps.workflowNameInput.value = workflow.meta.name ?? "";
  }
  if (options.force || deps.workflowCategorySelect.value === "custom") {
    deps.workflowCategorySelect.value = workflow.meta.category ?? "custom";
  }
}

export async function syncWorkflow(deps: WorkflowActionDeps): Promise<void> {
  const workflow = await buildWorkflow(deps);
  try {
    const review = createPublishReview({ quality: workflow.quality ?? calculateQualityReport(workflow.actions), warningsAccepted: false });
    if (!review.publishable) {
      const ok = confirm(`Workflow quality warnings:\n\n${review.warnings.join("\n")}\n\nPublish anyway?`);
      if (!ok) {
        deps.setMessage("Sync cancelled. Review workflow quality warnings first.");
        return;
      }
    }
    const serverUrl = await deps.getServerUrl();
    const response = await fetch(`${serverUrl}/api/workflows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, options: { compile: true, enableImmediately: true } })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Unknown error" }));
      deps.setMessage(`Sync failed: ${body.error ?? response.statusText}`);
      return;
    }
    const result = await response.json();
    void chrome.tabs.create({ url: `${serverUrl}/#workflows` });
    deps.setMessage(`Workflow synced. ID: ${result.id}`);
  } catch (error) {
    deps.setMessage(`Sync failed: ${formatError(error)}`);
  }
}

export async function buildWorkflow(deps: WorkflowActionDeps): Promise<RecordedWorkflow> {
  const response = await deps.sendMessage({ type: "BUILD_WORKFLOW" });
  const workflow = response?.workflow as RecordedWorkflow | undefined;
  if (!workflow) {
    throw new Error("Could not build workflow from the current recording.");
  }

  workflow.meta.name = deps.workflowNameInput.value || deps.currentWorkflow?.meta.name || "Untitled Workflow";
  workflow.meta.category = deps.workflowCategorySelect.value as RecordedWorkflow["meta"]["category"];
  deps.setCurrentWorkflow(workflow);
  workflow.quality = calculateQualityReport(workflow.actions);
  return workflow;
}
