import { Fragment, useState } from "react";
import {
  calculateQualityReport,
  generateAssertions,
  flattenActions,
  moveStep,
  deleteStep,
  insertStep,
  insertIntoBranch,
  makeNavigationAction,
  makeAssertionAction,
  makeScreenshotAction,
  makeWaitAction,
  makeDialogAction,
  makeIfBlock,
  sanitizeAction,
  scoreSelector,
  WEB_UI_CAPABILITIES,
  type WorkflowEditorCapabilities
} from "@zoom-automation/workflow-core";
import type { RecordedWorkflowView, RecordedActionView } from "../api.js";
import { StepDetail } from "./StepDetail.js";

interface WorkflowEditorProps {
  workflow: RecordedWorkflowView;
  onSave(workflow: RecordedWorkflowView): void;
  onClose(): void;
  onDuplicate?(): void;
  capabilities?: WorkflowEditorCapabilities;
}

type AddableType = "navigate" | "assert" | "screenshot" | "wait" | "dialog" | "if";

/** Recursively replace an action by id with a fully-updated object. */
function replaceById(actions: RecordedActionView[], updated: RecordedActionView): RecordedActionView[] {
  return actions.map((action) => {
    if (action.id === updated.id) return updated;
    if (action.type === "if") {
      return {
        ...action,
        thenActions: action.thenActions ? replaceById(action.thenActions, updated) : action.thenActions,
        elseActions: action.elseActions ? replaceById(action.elseActions, updated) : action.elseActions
      };
    }
    return action;
  });
}

export function WorkflowEditor({ workflow, onSave, onClose, onDuplicate, capabilities = WEB_UI_CAPABILITIES }: WorkflowEditorProps) {
  const [steps, setSteps] = useState<RecordedActionView[]>(workflow.actions);
  const startUrl = workflow.meta.recordedOnUrl ?? "";
  const flat = flattenActions(steps);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(steps[0]?.id);
  const [name, setName] = useState(workflow.meta.name);
  const [dirty, setDirty] = useState(false);

  const selectedStep = flat.find((s) => s.id === selectedStepId);
  const quality = computeQuality(steps);
  const avgConfidence = averageConfidence(flat);

  const commit = (next: RecordedActionView[]) => {
    setSteps(next);
    setDirty(true);
  };

  const makeStep = (type: AddableType): RecordedActionView => {
    switch (type) {
      case "navigate": return makeNavigationAction("");
      case "assert": return makeAssertionAction("textVisible", "", startUrl);
      case "screenshot": return makeScreenshotAction("evidence", startUrl);
      case "dialog": return makeDialogAction("accept", undefined, startUrl);
      case "if": return makeIfBlock();
      default: return makeWaitAction(1_000, startUrl);
    }
  };

  const handleAddStep = (type: AddableType, afterId?: string) => {
    const action = makeStep(type);
    commit(insertStep(steps, action, afterId ?? null));
    setSelectedStepId(action.id);
  };

  const handleAddToBranch = (ifId: string, branch: "then" | "else") => {
    const action = makeWaitAction(1_000, startUrl);
    commit(insertIntoBranch(steps, ifId, branch, action));
    setSelectedStepId(action.id);
  };

  const handleDeleteStep = (stepId: string) => {
    const next = deleteStep(steps, stepId);
    if (selectedStepId === stepId) {
      setSelectedStepId(flattenActions(next)[0]?.id);
    }
    commit(next);
  };

  const handleUpdateStep = (updated: RecordedActionView) => {
    commit(replaceById(steps, updated));
  };

  const handleMove = (stepId: string, direction: "up" | "down") => {
    commit(moveStep(steps, stepId, direction));
  };

  const handleSave = () => {
    const sanitized = steps.map(sanitizeAction);
    onSave({
      ...workflow,
      meta: { ...workflow.meta, name },
      actions: sanitized,
      assertions: generateAssertions(sanitized),
      quality: computeQuality(sanitized)
    });
    setDirty(false);
  };

  const renderRow = (step: RecordedActionView, depth: number) => (
    <Fragment key={step.id}>
      <div
        className={`editor-step-item ${selectedStepId === step.id ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => setSelectedStepId(step.id)}
      >
        <span className={`step-type-badge step-type-${step.type}`}>{step.type}</span>
        <span className="step-description">{step.description ?? step.value ?? step.url ?? "—"}</span>
        {capabilities.canEditSteps ? (
          <div className="step-item-actions">
            <button className="step-action-btn" title="Move up" onClick={(e) => { e.stopPropagation(); handleMove(step.id, "up"); }}>↑</button>
            <button className="step-action-btn" title="Move down" onClick={(e) => { e.stopPropagation(); handleMove(step.id, "down"); }}>↓</button>
            <button className="step-action-btn" title="Insert step after" onClick={(e) => { e.stopPropagation(); handleAddStep("wait", step.id); }}>+</button>
            <button className="step-action-btn danger" title="Delete step" onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }}>×</button>
          </div>
        ) : null}
      </div>
      {step.type === "if" ? (
        <div className="if-branches" style={{ marginLeft: 8 + depth * 18 }}>
          <div className="branch-label">Then</div>
          {(step.thenActions ?? []).map((child) => renderRow(child, depth + 1))}
          {capabilities.canEditSteps ? (
            <button className="step-add-btn" onClick={() => handleAddToBranch(step.id, "then")}>+ step in Then</button>
          ) : null}
          <div className="branch-label">Else</div>
          {(step.elseActions ?? []).map((child) => renderRow(child, depth + 1))}
          {capabilities.canEditSteps ? (
            <button className="step-add-btn" onClick={() => handleAddToBranch(step.id, "else")}>+ step in Else</button>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  );

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
          <span className="editor-step-count">{flat.length} steps</span>
          {dirty ? <span className="editor-dirty-badge">Unsaved</span> : null}
          {onDuplicate ? <button className="tertiary-button" onClick={onDuplicate}>Duplicate</button> : null}
          <button className="primary-button" onClick={handleSave} disabled={!dirty}>Save</button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-step-list">
          <div className="workflow-quality-card">
            <div>
              <span className={`workflow-quality-score ${quality.score >= 80 ? "good" : quality.score >= 60 ? "warn" : "bad"}`}>{quality.score}</span>
              <strong>Workflow quality</strong>
            </div>
            <small>{quality.selectorStability}% selectors · {quality.assertionCoverage}% assertions · {quality.evidenceCoverage}% evidence{avgConfidence !== undefined ? ` · ${avgConfidence} avg confidence` : ""}</small>
            {quality.warnings.length > 0 ? (
              <ul>
                {quality.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
          </div>
          <div className="step-list-header">
            <span>Steps</span>
          </div>

          {steps.map((step) => renderRow(step, 0))}
          {steps.length === 0 ? (
            <div className="editor-empty">No steps. Record a workflow in the Chrome extension to get started.</div>
          ) : null}

          {capabilities.canEditSteps ? (
            <div className="step-add-toolbar" role="group" aria-label="Add a manual step">
              <span className="step-add-label">Add step:</span>
              {(["navigate", "assert", "screenshot", "wait", "dialog", "if"] as AddableType[]).map((type) => (
                <button key={type} className="step-add-btn" onClick={() => handleAddStep(type, selectedStepId)}>
                  {type === "if" ? "If block" : type}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="editor-detail-panel">
          {selectedStep ? (
            <StepDetail
              step={selectedStep}
              stepIndex={flat.indexOf(selectedStep)}
              totalSteps={flat.length}
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

/** Average static selector confidence across steps that have selectors. */
function averageConfidence(flat: RecordedActionView[]): number | undefined {
  const scored = flat
    .filter((s) => !["navigate", "wait", "dialog", "if", "screenshot", "dismiss"].includes(s.type))
    .map((s) => scoreSelector(s.selectors).score);
  if (scored.length === 0) return undefined;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}
