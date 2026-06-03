import { useState } from "react";
import type { RecordedActionView } from "../api.js";

interface StepDetailProps {
  step: RecordedActionView;
  stepIndex: number;
  totalSteps: number;
  onUpdate(step: RecordedActionView): void;
  onDelete(): void;
  onMoveUp(): void;
  onMoveDown(): void;
}

export function StepDetail({ step, stepIndex, totalSteps, onUpdate, onDelete, onMoveUp, onMoveDown }: StepDetailProps) {
  const [editingValue, setEditingValue] = useState(false);

  const updateField = <K extends keyof RecordedActionView>(key: K, value: RecordedActionView[K]) => {
    onUpdate({ ...step, [key]: value });
  };

  const updateSelector = (key: string, value: string) => {
    const selectors = { ...step.selectors };
    if (key === "role.name") {
      selectors.role = { ...selectors.role, role: selectors.role?.role ?? "button", name: value || undefined };
    } else if (key === "role.role") {
      selectors.role = { ...selectors.role, role: value, name: selectors.role?.name };
    } else {
      (selectors as any)[key] = value || undefined;
    }
    onUpdate({ ...step, selectors });
  };

  return (
    <div className="step-detail">
      <div className="step-detail-header">
        <div className="step-detail-title">
          <span className={`step-type-badge step-type-${step.type}`}>{step.type}</span>
          <span>Step {stepIndex + 1} of {totalSteps}</span>
        </div>
        <div className="step-detail-actions">
          <button className="icon-button" onClick={onMoveUp} disabled={stepIndex === 0} title="Move up">↑</button>
          <button className="icon-button" onClick={onMoveDown} disabled={stepIndex === totalSteps - 1} title="Move down">↓</button>
          <button className="icon-button danger" onClick={onDelete} title="Delete step">🗑</button>
        </div>
      </div>

      {/* Description */}
      <div className="detail-section">
        <label className="detail-label">Description</label>
        <input
          className="detail-input"
          value={step.description ?? ""}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="What this step does"
        />
      </div>

      {/* Action Type */}
      <div className="detail-section">
        <label className="detail-label">Action Type</label>
        <select
          className="detail-select"
          value={step.type}
          onChange={(e) => updateField("type", e.target.value as RecordedActionView["type"])}
        >
          <option value="click">Click</option>
          <option value="fill">Fill</option>
          <option value="select">Select</option>
          <option value="navigate">Navigate</option>
          <option value="upload">Upload</option>
          <option value="wait">Wait</option>
          <option value="assert">Assert</option>
          <option value="dismiss">Dismiss popup</option>
        </select>
      </div>

      {/* Value (for fill/select) */}
      {(step.type === "fill" || step.type === "select") ? (
        <div className="detail-section">
          <label className="detail-label">
            Value
            {step.value?.includes("{{") ? (
              <span className="param-indicator" title="This value is parameterized">⚡ Parameterized</span>
            ) : null}
          </label>
          <input
            className="detail-input mono"
            value={step.value ?? ""}
            onChange={(e) => updateField("value", e.target.value)}
            placeholder="Value to enter (use {{param.name}} for variables)"
          />
          <small className="detail-hint">
            Use <code>{"{{address.line1}}"}</code>, <code>{"{{contact.email}}"}</code>, etc. for parameterized values.
          </small>
        </div>
      ) : null}

      {/* URL (for navigate) */}
      {step.type === "navigate" ? (
        <div className="detail-section">
          <label className="detail-label">URL</label>
          <input
            className="detail-input mono"
            value={step.url ?? ""}
            onChange={(e) => updateField("url", e.target.value)}
            placeholder="https://zoom.us/..."
          />
        </div>
      ) : null}

      {/* Selectors */}
      {step.type !== "navigate" ? (
        <div className="detail-section">
          <label className="detail-label">Selectors (priority order)</label>
          <div className="selector-grid">
            <div className="selector-row">
              <span className="selector-strategy">Role</span>
              <input
                className="detail-input-sm"
                value={step.selectors.role?.role ?? ""}
                onChange={(e) => updateSelector("role.role", e.target.value)}
                placeholder="button, textbox, combobox..."
              />
              <input
                className="detail-input-sm"
                value={step.selectors.role?.name ?? ""}
                onChange={(e) => updateSelector("role.name", e.target.value)}
                placeholder="Accessible name"
              />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">Label</span>
              <input
                className="detail-input"
                value={step.selectors.label ?? ""}
                onChange={(e) => updateSelector("label", e.target.value)}
                placeholder="Field label text"
              />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">Text</span>
              <input
                className="detail-input"
                value={step.selectors.text ?? ""}
                onChange={(e) => updateSelector("text", e.target.value)}
                placeholder="Visible text content"
              />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">Test ID</span>
              <input
                className="detail-input"
                value={step.selectors.testId ?? ""}
                onChange={(e) => updateSelector("testId", e.target.value)}
                placeholder="data-testid value"
              />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">CSS</span>
              <input
                className="detail-input mono"
                value={step.selectors.css ?? ""}
                onChange={(e) => updateSelector("css", e.target.value)}
                placeholder=".class > element (fallback)"
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Conditional toggle */}
      <div className="detail-section">
        <label className="detail-label">Behavior</label>
        <div className="detail-grid two">
          <div>
            <label className="detail-sublabel">Timeout</label>
            <input
              className="detail-input-sm"
              type="number"
              min={500}
              max={60000}
              step={500}
              value={step.timeout ?? 10000}
              onChange={(e) => updateField("timeout", Number(e.target.value) || 10000)}
            />
          </div>
          <div>
            <label className="detail-sublabel">Retries</label>
            <input
              className="detail-input-sm"
              type="number"
              min={0}
              max={10}
              value={step.retryCount ?? 0}
              onChange={(e) => updateField("retryCount", Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="detail-sublabel">Retry delay</label>
            <input
              className="detail-input-sm"
              type="number"
              min={0}
              max={60000}
              step={250}
              value={step.retryDelayMs ?? 1000}
              onChange={(e) => updateField("retryDelayMs", Number(e.target.value) || 1000)}
            />
          </div>
          <div>
            <label className="detail-sublabel">Condition</label>
            <select
              className="detail-select"
              value={step.condition?.type ?? "none"}
              onChange={(e) => updateField("condition", e.target.value === "none" ? undefined : { type: e.target.value as NonNullable<RecordedActionView["condition"]>["type"], text: step.condition?.text, selector: step.selectors })}
            >
              <option value="none">None</option>
              <option value="textExistsSkip">If text exists, skip</option>
              <option value="elementVisibleClick">If element visible, click</option>
              <option value="fieldEmptyFill">If field empty, fill</option>
              <option value="addressAlreadyExistsSkipAccount">If address exists, skip account</option>
            </select>
          </div>
        </div>
        {step.condition ? (
          <input
            className="detail-input"
            value={step.condition.text ?? ""}
            onChange={(e) => updateField("condition", { ...step.condition!, text: e.target.value, selector: step.selectors })}
            placeholder="Condition text"
          />
        ) : null}
        <div className="detail-toggles">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={step.continueOnFailure ?? false}
              onChange={(e) => updateField("continueOnFailure", e.target.checked)}
            />
            <span>Continue on failure</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={step.screenshotOnFailure ?? false}
              onChange={(e) => updateField("screenshotOnFailure", e.target.checked)}
            />
            <span>Screenshot on failure</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={step.optional ?? false}
              onChange={(e) => updateField("optional" as any, e.target.checked)}
            />
            <span>Optional (skip if element not visible)</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={step.skipIfExists ?? false}
              onChange={(e) => updateField("skipIfExists" as any, e.target.checked)}
            />
            <span>Skip workflow if target already exists</span>
          </label>
        </div>
      </div>

      {/* Parameters detected */}
      {step.parameterHints && step.parameterHints.length > 0 ? (
        <div className="detail-section">
          <label className="detail-label">Detected Parameters</label>
          <div className="detail-params">
            {step.parameterHints.map((hint, i) => (
              <div key={i} className="detail-param-row">
                <code>{`{{${hint.suggestedName}}}`}</code>
                <span className="detail-param-original">← {hint.originalValue}</span>
                <span className={`detail-param-status ${hint.confirmed !== false ? "confirmed" : "dismissed"}`}>
                  {hint.confirmed !== false ? "✓" : "×"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Page context */}
      <div className="detail-section detail-context">
        <label className="detail-label">Recording Context</label>
        <small>Page: {step.pageTitle || "—"}</small>
        <small>URL: {step.pageUrl || "—"}</small>
      </div>
    </div>
  );
}
