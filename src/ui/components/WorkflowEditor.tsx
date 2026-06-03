import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordedWorkflowView, RecordedActionView, WorkflowQualityReportView } from "../api.js";
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
  const quality = workflow.quality ?? calculateQualityReport(steps);

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
      actions: steps,
      quality: calculateQualityReport(steps)
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

function calculateQualityReport(steps: RecordedActionView[]): WorkflowQualityReportView {
  const actionable = steps.filter((step) => !["navigate", "wait", "screenshot", "dismiss"].includes(step.type));
  const stableSelectors = actionable.filter((step) => step.selectors.role?.name || step.selectors.label || step.selectors.testId).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = steps.filter((step) => step.type === "click" && /save|submit|add|continue|confirm/i.test(step.selectors.role?.name ?? step.selectors.text ?? ""));
  const assertionActions = steps.filter((step) => step.type === "assert");
  const assertionCoverage = submitActions.length === 0 ? 100 : Math.round((Math.min(assertionActions.length, submitActions.length) / submitActions.length) * 100);
  const evidenceCount = steps.filter((step) => step.type === "screenshot" || step.screenshotOnFailure || step.onFailure === "screenshot").length;
  const evidenceCoverage = steps.length === 0 ? 100 : Math.round((evidenceCount / steps.length) * 100);
  const riskySteps = steps.filter((step) => step.type === "click" && !step.selectors.role?.name && !step.selectors.testId).length;
  const hardcodedValues = steps.filter((step) => {
    const value = step.value ?? step.expected ?? "";
    return value.length > 0 && !value.includes("{{") && step.type !== "assert";
  }).length;
  const unsupportedBrowserPreflightSteps = steps.filter((step) => step.type === "upload").length;
  const penalties = riskySteps * 7 + hardcodedValues * 3 + unsupportedBrowserPreflightSteps * 8;
  const score = Math.max(0, Math.min(100, Math.round((selectorStability * 0.35) + (assertionCoverage * 0.3) + (evidenceCoverage * 0.2) + 15 - penalties)));
  const warnings = [
    selectorStability < 70 ? "Several steps rely on weak selectors." : undefined,
    assertionCoverage < 80 ? "Add validations after important submit/save actions." : undefined,
    evidenceCoverage < 25 ? "Add screenshots for evidence and failure diagnosis." : undefined,
    unsupportedBrowserPreflightSteps > 0 ? "Upload steps cannot be tested by browser preflight." : undefined,
    hardcodedValues > 0 ? "Review hardcoded values before bulk runs." : undefined
  ].filter(Boolean) as string[];
  return { score, selectorStability, assertionCoverage, evidenceCoverage, riskySteps, hardcodedValues, unsupportedBrowserPreflightSteps, warnings };
}
