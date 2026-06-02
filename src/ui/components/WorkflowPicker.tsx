import type { WorkflowView } from "../api.js";
import { CheckIcon, ChevronRightIcon } from "./Icons.js";

interface WorkflowPickerProps {
  workflows: WorkflowView[];
  selectedWorkflowIds: Set<string>;
  onToggle(workflowId: string): void;
}

export function WorkflowPicker({ workflows, selectedWorkflowIds, onToggle }: WorkflowPickerProps) {
  return (
    <section className="panel" id="workflows">
      <div className="panel-header compact">
        <div>
          <h2>Workflows</h2>
          <p>Choose the operation to run for the selected accounts.</p>
        </div>
      </div>
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
              <span className={`status-badge ${workflow.enabled ? "success" : "neutral"}`}>
                {workflow.enabled ? "Available" : "Future"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
