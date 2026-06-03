import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordedWorkflowView, RecordedActionView } from "../api.js";
import { StepDetail } from "./StepDetail.js";

interface WorkflowEditorProps {
  workflow: RecordedWorkflowView;
  onSave(workflow: RecordedWorkflowView): void;
  onClose(): void;
}

export function WorkflowEditor({ workflow, onSave, onClose }: WorkflowEditorProps) {
  const [steps, setSteps] = useState<RecordedActionView[]>(workflow.actions);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(steps[0]?.id);
  const [name, setName] = useState(workflow.meta.name);
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | undefined>();
  const [dragOverIndex, setDragOverIndex] = useState<number | undefined>();
  const listRef = useRef<HTMLDivElement>(null);

  const selectedStep = steps.find((s) => s.id === selectedStepId);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (dragIndex === undefined || dragIndex === index) {
      setDragIndex(undefined);
      setDragOverIndex(undefined);
      return;
    }
    const next = [...steps];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setSteps(next);
    setDirty(true);
    setDragIndex(undefined);
    setDragOverIndex(undefined);
  };

  const handleDeleteStep = (stepId: string) => {
    setSteps((current) => current.filter((s) => s.id !== stepId));
    if (selectedStepId === stepId) {
      setSelectedStepId(steps[0]?.id !== stepId ? steps[0]?.id : steps[1]?.id);
    }
    setDirty(true);
  };

  const handleUpdateStep = (updated: RecordedActionView) => {
    setSteps((current) => current.map((s) => s.id === updated.id ? updated : s));
    setDirty(true);
  };

  const handleInsertStep = (afterId: string) => {
    const index = steps.findIndex((s) => s.id === afterId);
    const newStep: RecordedActionView = {
      id: `act_new_${Date.now().toString(36)}`,
      timestamp: Date.now(),
      type: "wait",
      selectors: {},
      pageUrl: "",
      pageTitle: "",
      description: "New step — edit me"
    };
    const next = [...steps];
    next.splice(index + 1, 0, newStep);
    setSteps(next);
    setSelectedStepId(newStep.id);
    setDirty(true);
  };

  const handleSave = () => {
    onSave({
      ...workflow,
      meta: { ...workflow.meta, name },
      actions: steps
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
          <button className="primary-button" onClick={handleSave} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-step-list" ref={listRef}>
          <div className="step-list-header">
            <span>Steps</span>
          </div>
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`editor-step-item ${selectedStepId === step.id ? "active" : ""} ${dragOverIndex === index ? "drag-over" : ""}`}
              onClick={() => setSelectedStepId(step.id)}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => { setDragIndex(undefined); setDragOverIndex(undefined); }}
            >
              <span className="step-drag-handle" aria-label="Drag to reorder">⋮⋮</span>
              <span className="step-index">{index + 1}</span>
              <span className={`step-type-badge step-type-${step.type}`}>{step.type}</span>
              <span className="step-description">{step.description ?? step.value ?? step.url ?? "—"}</span>
              <div className="step-item-actions">
                <button
                  className="step-action-btn"
                  onClick={(e) => { e.stopPropagation(); handleInsertStep(step.id); }}
                  title="Insert step after"
                >+</button>
                <button
                  className="step-action-btn danger"
                  onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }}
                  title="Delete step"
                >×</button>
              </div>
            </div>
          ))}
          {steps.length === 0 ? (
            <div className="editor-empty">No steps. Record a workflow to get started.</div>
          ) : null}
        </div>

        <div className="editor-detail-panel">
          {selectedStep ? (
            <StepDetail
              step={selectedStep}
              stepIndex={steps.indexOf(selectedStep)}
              totalSteps={steps.length}
              onUpdate={handleUpdateStep}
              onDelete={() => handleDeleteStep(selectedStep.id)}
              onMoveUp={() => {
                const idx = steps.indexOf(selectedStep);
                if (idx > 0) {
                  const next = [...steps];
                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                  setSteps(next);
                  setDirty(true);
                }
              }}
              onMoveDown={() => {
                const idx = steps.indexOf(selectedStep);
                if (idx < steps.length - 1) {
                  const next = [...steps];
                  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                  setSteps(next);
                  setDirty(true);
                }
              }}
            />
          ) : (
            <div className="editor-empty">Select a step to view details.</div>
          )}
        </div>
      </div>
    </div>
  );
}
