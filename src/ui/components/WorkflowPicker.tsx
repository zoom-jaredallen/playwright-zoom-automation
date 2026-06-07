import type { WorkflowView } from "../api.js";
import { CheckIcon, ChevronRightIcon } from "./Icons.js";

interface WorkflowPickerProps {
  workflows: WorkflowView[];
  selectedWorkflowIds: Set<string>;
  pipelineOrder: string[];
  onToggle(workflowId: string): void;
  onReorder?(order: string[]): void;
}

export function WorkflowPicker({ workflows, selectedWorkflowIds, pipelineOrder, onToggle, onReorder }: WorkflowPickerProps) {
  const isPipeline = pipelineOrder.length > 1;

  const moveUp = (workflowId: string) => {
    const index = pipelineOrder.indexOf(workflowId);
    if (index <= 0 || !onReorder) return;
    const next = [...pipelineOrder];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onReorder(next);
  };

  const moveDown = (workflowId: string) => {
    const index = pipelineOrder.indexOf(workflowId);
    if (index < 0 || index >= pipelineOrder.length - 1 || !onReorder) return;
    const next = [...pipelineOrder];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onReorder(next);
  };

  return (
    <section className="panel" id="workflows">
      <div className="panel-header compact">
        <div>
          <h2>Workflows</h2>
          <p>
            {pipelineOrder.length === 0
              ? "Select one or more workflows to run on each account."
              : pipelineOrder.length === 1
              ? `1 workflow selected. Add more to create a pipeline.`
              : `Pipeline: ${pipelineOrder.length} workflows will run in sequence per account.`}
          </p>
        </div>
      </div>

      {pipelineOrder.length > 0 ? (
        <div className="pipeline-order">
          {pipelineOrder.map((id, index) => {
            const workflow = workflows.find((w) => w.id === id);
            if (!workflow) return null;
            return (
              <div key={id} className="pipeline-step">
                <span className="pipeline-step-number">{index + 1}</span>
                <span className="pipeline-step-name">{workflow.name}</span>
                {isPipeline ? (
                  <div className="pipeline-step-actions">
                    <button className="icon-button" onClick={() => moveUp(id)} disabled={index === 0} aria-label="Move up">↑</button>
                    <button className="icon-button" onClick={() => moveDown(id)} disabled={index === pipelineOrder.length - 1} aria-label="Move down">↓</button>
                    <button className="icon-button" onClick={() => onToggle(id)} aria-label="Remove">×</button>
                  </div>
                ) : (
                  <div className="pipeline-step-actions">
                    <button className="icon-button" onClick={() => onToggle(id)} aria-label="Remove">×</button>
                  </div>
                )}
              </div>
            );
          })}
          {isPipeline ? (
            <div className="pipeline-connector">
              <small>Workflows run top → bottom for each account</small>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="workflow-list">
        {workflows.map((workflow) => {
          const selected = selectedWorkflowIds.has(workflow.id);
          return (
            <button
              key={workflow.id}
              className={`workflow-item ${selected ? "selected" : ""}`}
              disabled={!workflow.enabled}
              onClick={() => onToggle(workflow.id)}
            >
              <span className="workflow-check">{selected ? <CheckIcon /> : <ChevronRightIcon />}</span>
              <span className="workflow-copy">
                <strong>{workflow.name}</strong>
                <small>{workflow.description}</small>
              </span>
              <span className={`status-badge ${badgeClass(workflow)}`}>
                {workflow.enabled ? badgeLabel(workflow) : "Future"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function badgeLabel(workflow: WorkflowView): string {
  if (workflow.lifecycleStatus && workflow.lifecycleStatus !== "published") return workflow.lifecycleStatus;
  return "Available";
}

function badgeClass(workflow: WorkflowView): string {
  if (!workflow.enabled) return "neutral";
  if (workflow.lifecycleStatus === "draft" || workflow.lifecycleStatus === "validated") return "warning";
  if (workflow.lifecycleStatus === "deprecated" || workflow.lifecycleStatus === "archived") return "error";
  return "success";
}
