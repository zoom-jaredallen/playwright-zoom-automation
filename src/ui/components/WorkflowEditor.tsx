import { useRef, useState } from "react";
import {
  calculateQualityReport,
  generateAssertions,
  moveStep,
  deleteStep,
  insertStep,
  makeNavigationAction,
  makeAssertionAction,
  makeScreenshotAction,
  makeWaitAction,
  makeDialogAction,
  sanitizeAction,
  WEB_UI_CAPABILITIES,
  type WorkflowEditorCapabilities
} from "@zoom-automation/workflow-core";
import type { RecordedWorkflowView, RecordedActionView } from "../api.js";
import { StepDetail } from "./StepDetail.js";

interface WorkflowEditorProps {
  workflow: RecordedWorkflowView;
  onSave(workflow: RecordedWorkflowView): void;
  onClose(): void;
  /** Open the duplicate dialog for this workflow. */
  onDuplicate?(): void;
  /** Defaults to the Web UI capability set (no record / browser preflight). */
  capabilities?: WorkflowEditorCapabilities;
}

type AddableType = "navigate" | "assert" | "screenshot" | "wait" | "dialog";

export function WorkflowEditor({ workflow, onSave, onClose, onDuplicate, capabilities = WEB_UI_CAPABILITIES }: WorkflowEditorProps) {
  const [steps, setSteps] = useState<RecordedActionView[]>(workflow.actions);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(steps[0]?.id);
  const [name, setName] = useState(workflow.meta.name);
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | undefined>();
  const [dragOverIndex, setDragOverIndex] = useState<number | undefined>();
  const listRef = useRef<HTMLDivElement>(null);

  const selectedStep = steps.find((s) => s.id === selectedStepId);
  // Recompute quality live from the shared analysis so it matches the extension exactly.
  const quality = computeQuality(steps);

  const commit = (next: RecordedActionView[]) => {
    setSteps(next);
    setDirty(true);
  };

  const handleDragStart = (index: number) => {
    if (!capabilities.canReorder) return;
    setDragIndex(index);
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (!capabilities.canReorder || dragIndex === undefined || dragIndex === index) {
      setDragIndex(undefined);
      setDragOverIndex(undefined);
      return;
    }
    const next = [...steps];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    commit(next);
    setDragIndex(undefined);
    setDragOverIndex(undefined);
  };

  const handleDeleteStep = (stepId: string) => {
    const next = deleteStep(steps, stepId);
    if (selectedStepId === stepId) {
      const removedIndex = steps.findIndex((s) => s.id === stepId);
      setSelectedStepId(next[removedIndex]?.id ?? next[removedIndex - 1]?.id ?? next[0]?.id);
    }
    commit(next);
  };

  const handleUpdateStep = (updated: RecordedActionView) => {
    commit(steps.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleAddStep = (type: AddableType, afterId?: string) => {
    const startUrl = workflow.meta.recordedOnUrl ?? "";
    const action =
      type === "navigate" ? makeNavigationAction("")
      : type === "assert" ? makeAssertionAction("textVisible", "", startUrl)
      : type === "screenshot" ? makeScreenshotAction("evidence", startUrl)
      : type === "dialog" ? makeDialogAction("accept", undefined, startUrl)
      : makeWaitAction(1_000, startUrl);
    const next = insertStep(steps, action, afterId ?? null);
    setSelectedStepId(action.id);
    commit(next);
  };

  const handleMove = (stepId: string, direction: "up" | "down") => {
    commit(moveStep(steps, stepId, direction));
  };

  const handleSave = () => {
    // Normalize URLs and drop type-stale fields so the saved workflow recompiles cleanly.
    const sanitized = steps.map(sanitizeAction);
    onSave({
      ...workflow,
      meta: { ...workflow.meta, name },
      actions: sanitized,
      // Keep assertions + quality internally consistent with the edited steps.
      assertions: generateAssertions(sanitized),
      quality: computeQuality(sanitized)
    });
    setDirty(false);
  };

  return (
    <div className="workflow-editor">
      <div className="editor-header">
        <div className="editor-header-left">
          <button className="icon-button" onClick={onClose} aria-label="Close editor">←</button>
          <input
            className="editor-name-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            placeholder="Workflow name"
          />
        </div>
        <div className="editor-header-right">
          <span className="editor-step-count">{steps.length} steps</span>
          {dirty ? <span className="editor-dirty-badge">Unsaved</span> : null}
          {onDuplicate ? (
            <button className="tertiary-button" onClick={onDuplicate}>
              Duplicate
            </button>
          ) : null}
          <button className="primary-button" onClick={handleSave} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-step-list" ref={listRef}>
          <div className="workflow-quality-card">
            <div>
              <span className={`workflow-quality-score ${quality.score >= 80 ? "good" : quality.score >= 60 ? "warn" : "bad"}`}>{quality.score}</span>
              <strong>Workflow quality</strong>
            </div>
            <small>{quality.selectorStability}% selectors · {quality.assertionCoverage}% assertions · {quality.evidenceCoverage}% evidence</small>
            {quality.warnings.length > 0 ? (
              <ul>
                {quality.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
          </div>
          <div className="step-list-header">
            <span>Steps</span>
          </div>
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`editor-step-item ${selectedStepId === step.id ? "active" : ""} ${dragOverIndex === index ? "drag-over" : ""}`}
              onClick={() => setSelectedStepId(step.id)}
              draggable={capabilities.canReorder}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => { setDragIndex(undefined); setDragOverIndex(undefined); }}
            >
              {capabilities.canReorder ? <span className="step-drag-handle" aria-label="Drag to reorder">⋮⋮</span> : null}
              <span className="step-index">{index + 1}</span>
              <span className={`step-type-badge step-type-${step.type}`}>{step.type}</span>
              <span className="step-description">{step.description ?? step.value ?? step.url ?? "—"}</span>
              {capabilities.canEditSteps ? (
                <div className="step-item-actions">
                  <button
                    className="step-action-btn"
                    onClick={(e) => { e.stopPropagation(); handleAddStep("wait", step.id); }}
                    title="Insert step after"
                  >+</button>
                  <button
                    className="step-action-btn danger"
                    onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }}
                    title="Delete step"
                  >×</button>
                </div>
              ) : null}
            </div>
          ))}
          {steps.length === 0 ? (
            <div className="editor-empty">No steps. Record a workflow in the Chrome extension to get started.</div>
          ) : null}

          {capabilities.canEditSteps ? (
            <div className="step-add-toolbar" role="group" aria-label="Add a manual step">
              <span className="step-add-label">Add step:</span>
              {(["navigate", "assert", "screenshot", "wait", "dialog"] as AddableType[]).map((type) => (
                <button key={type} className="step-add-btn" onClick={() => handleAddStep(type, selectedStepId)}>
                  {type}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="editor-detail-panel">
          {selectedStep ? (
            <StepDetail
              step={selectedStep}
              stepIndex={steps.indexOf(selectedStep)}
              totalSteps={steps.length}
              capabilities={capabilities}
              onUpdate={handleUpdateStep}
              onDelete={() => handleDeleteStep(selectedStep.id)}
              onMoveUp={() => handleMove(selectedStep.id, "up")}
              onMoveDown={() => handleMove(selectedStep.id, "down")}
            />
          ) : (
            <div className="editor-empty">Select a step to view details.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function computeQuality(steps: RecordedActionView[]) {
  return calculateQualityReport(steps, generateAssertions(steps));
}
