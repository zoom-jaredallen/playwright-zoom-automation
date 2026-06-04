import type { Predicate, WorkflowEditorCapabilities } from "@zoom-automation/workflow-core";
import { EXTENSION_CAPABILITIES, sanitizeAction, scoreSelector } from "@zoom-automation/workflow-core";
import type { RecordedActionView } from "../api.js";
import { PredicateEditor } from "./PredicateEditor.js";

interface StepDetailProps {
  step: RecordedActionView;
  stepIndex: number;
  totalSteps: number;
  onUpdate(step: RecordedActionView): void;
  onDelete(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  capabilities?: WorkflowEditorCapabilities;
}

const ACTION_TYPES: RecordedActionView["type"][] = [
  "click", "fill", "select", "navigate", "upload", "wait",
  "assert", "screenshot", "dismiss", "hover", "press", "download", "dialog"
];

const ASSERTION_TYPES: NonNullable<RecordedActionView["assertionType"]>[] = [
  "textVisible", "elementVisible", "urlContains", "fieldValue", "tableRowContains", "hasText", "hasValue"
];

export function StepDetail({
  step,
  stepIndex,
  totalSteps,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  capabilities = EXTENSION_CAPABILITIES
}: StepDetailProps) {
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
      (selectors as Record<string, unknown>)[key] = value || undefined;
    }
    onUpdate({ ...step, selectors });
  };

  const toggleParameter = (index: number) => {
    if (!step.parameterHints) return;
    const parameterHints = step.parameterHints.map((hint, i) =>
      i === index ? { ...hint, confirmed: hint.confirmed === false } : hint
    );
    onUpdate({ ...step, parameterHints });
  };

  // Update an ARIA-state option / exact flag on the role selector (tri-state via "", "true", "false").
  const updateRoleFlag = (key: "checked" | "expanded" | "selected" | "exact", raw: string) => {
    const role = { ...(step.selectors.role ?? { role: "button" }) };
    if (raw === "") delete (role as Record<string, unknown>)[key];
    else (role as Record<string, unknown>)[key] = raw === "true";
    onUpdate({ ...step, selectors: { ...step.selectors, role } });
  };

  const updateAnchor = (patch: Partial<NonNullable<RecordedActionView["selectors"]["anchor"]>>) => {
    const anchor = { ...(step.selectors.anchor ?? {}), ...patch };
    const cleaned = anchor.text || anchor.scopeRole ? anchor : undefined;
    onUpdate({ ...step, selectors: { ...step.selectors, anchor: cleaned } });
  };

  const isIf = step.type === "if";
  const hasSelectors = !["navigate", "wait", "dialog", "if"].includes(step.type);
  const confidence = hasSelectors ? scoreSelector(step.selectors) : undefined;
  const triState = (value: boolean | undefined) => (value === undefined ? "" : String(value));

  return (
    <div className="step-detail">
      <div className="step-detail-header">
        <div className="step-detail-title">
          <span className={`step-type-badge step-type-${step.type}`}>{step.type}</span>
          <span>Step {stepIndex + 1} of {totalSteps}</span>
        </div>
        <div className="step-detail-actions">
          <button className="icon-button" onClick={onMoveUp} disabled={!capabilities.canReorder || stepIndex === 0} title="Move up">↑</button>
          <button className="icon-button" onClick={onMoveDown} disabled={!capabilities.canReorder || stepIndex === totalSteps - 1} title="Move down">↓</button>
          <button className="icon-button danger" onClick={onDelete} disabled={!capabilities.canEditSteps} title="Delete step">🗑</button>
        </div>
      </div>

      {/* Selector confidence (static heuristic) */}
      {confidence ? (
        <div className={`selector-confidence confidence-${confidence.level}`} title={confidence.reasons.join("\n")}>
          <span className="confidence-dot" />
          <strong>Selector confidence: {confidence.score}</strong>
          <span className="confidence-level">{confidence.level}</span>
        </div>
      ) : null}

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

      {/* IF block condition */}
      {isIf ? (
        <div className="detail-section">
          <label className="detail-label">IF condition</label>
          <small className="detail-hint">Steps in the THEN branch run when this is true; ELSE runs otherwise.</small>
          <PredicateEditor
            value={step.ifCondition ?? { kind: "always" }}
            onChange={(ifCondition) => onUpdate({ ...step, ifCondition })}
          />
        </div>
      ) : null}

      {/* Action Type */}
      {!isIf ? (
        <div className="detail-section">
          <label className="detail-label">Action Type</label>
          <select
            className="detail-select"
            value={step.type}
            onChange={(e) => onUpdate(sanitizeAction({ ...step, type: e.target.value as RecordedActionView["type"] }))}
          >
            {ACTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
      ) : null}

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

      {/* URL + waitForUrl (for navigate) */}
      {step.type === "navigate" ? (
        <div className="detail-section">
          <label className="detail-label">URL</label>
          <input
            className="detail-input mono"
            value={step.url ?? ""}
            onChange={(e) => updateField("url", e.target.value)}
            placeholder="https://zoom.us/..."
          />
          <label className="detail-sublabel">Wait for URL (optional)</label>
          <input
            className="detail-input mono"
            value={step.waitForUrl ?? ""}
            onChange={(e) => updateField("waitForUrl", e.target.value || undefined)}
            placeholder="#/business-address"
          />
        </div>
      ) : null}

      {/* Key (for press) */}
      {step.type === "press" ? (
        <div className="detail-section">
          <label className="detail-label">Key</label>
          <input
            className="detail-input mono"
            value={step.key ?? ""}
            onChange={(e) => updateField("key", e.target.value)}
            placeholder="Enter, Tab, Escape, ArrowDown…"
          />
        </div>
      ) : null}

      {/* Wait (for wait) */}
      {step.type === "wait" ? (
        <div className="detail-section">
          <label className="detail-label">Wait (ms)</label>
          <input
            className="detail-input-sm"
            type="number"
            min={250}
            max={60000}
            step={250}
            value={step.waitMs ?? 1000}
            onChange={(e) => updateField("waitMs", Number(e.target.value) || 1000)}
          />
        </div>
      ) : null}

      {/* Screenshot options */}
      {step.type === "screenshot" ? (
        <div className="detail-section">
          <label className="detail-label">Screenshot</label>
          <input
            className="detail-input"
            value={step.screenshotLabel ?? ""}
            onChange={(e) => updateField("screenshotLabel", e.target.value)}
            placeholder="Label (e.g. evidence)"
          />
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={step.elementScreenshot ?? false}
              onChange={(e) => updateField("elementScreenshot", e.target.checked)}
            />
            <span>Scope to matched element</span>
          </label>
        </div>
      ) : null}

      {/* Dialog options */}
      {step.type === "dialog" ? (
        <div className="detail-section">
          <label className="detail-label">Native dialog</label>
          <select
            className="detail-select"
            value={step.dialogAction ?? "accept"}
            onChange={(e) => updateField("dialogAction", e.target.value as RecordedActionView["dialogAction"])}
          >
            <option value="accept">Accept</option>
            <option value="dismiss">Dismiss</option>
          </select>
          {step.dialogAction !== "dismiss" ? (
            <input
              className="detail-input"
              value={step.dialogPromptText ?? ""}
              onChange={(e) => updateField("dialogPromptText", e.target.value || undefined)}
              placeholder="Prompt text (optional)"
            />
          ) : null}
        </div>
      ) : null}

      {/* Assertion editor */}
      {step.type === "assert" ? (
        <div className="detail-section">
          <label className="detail-label">Assertion</label>
          <select
            className="detail-select"
            value={step.assertionType ?? "textVisible"}
            onChange={(e) => updateField("assertionType", e.target.value as RecordedActionView["assertionType"])}
          >
            {ASSERTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input
            className="detail-input mono"
            value={step.expected ?? ""}
            onChange={(e) => updateField("expected", e.target.value)}
            placeholder="Expected text / URL fragment / selector"
          />
          <label className="detail-sublabel">On failure</label>
          <select
            className="detail-select"
            value={step.onFailure ?? "screenshot"}
            onChange={(e) => updateField("onFailure", e.target.value as RecordedActionView["onFailure"])}
          >
            <option value="fail">Fail</option>
            <option value="retry">Retry</option>
            <option value="skip">Skip</option>
            <option value="screenshot">Screenshot</option>
          </select>
        </div>
      ) : null}

      {/* Selectors */}
      {hasSelectors && capabilities.canEditSelectors ? (
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
              <input className="detail-input" value={step.selectors.label ?? ""} onChange={(e) => updateSelector("label", e.target.value)} placeholder="Field label text" />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">Text</span>
              <input className="detail-input" value={step.selectors.text ?? ""} onChange={(e) => updateSelector("text", e.target.value)} placeholder="Visible text content" />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">Test ID</span>
              <input className="detail-input" value={step.selectors.testId ?? ""} onChange={(e) => updateSelector("testId", e.target.value)} placeholder="data-testid value" />
            </div>
            <div className="selector-row">
              <span className="selector-strategy">CSS</span>
              <input className="detail-input mono" value={step.selectors.css ?? ""} onChange={(e) => updateSelector("css", e.target.value)} placeholder=".class > element (fallback)" />
            </div>
          </div>

          {/* ARIA-state options — disambiguate e.g. the *checked* checkbox */}
          <label className="detail-sublabel">Match by ARIA state</label>
          <div className="detail-grid two">
            <label className="aria-state-field">
              Checked
              <select className="detail-select" value={triState(step.selectors.role?.checked)} onChange={(e) => updateRoleFlag("checked", e.target.value)}>
                <option value="">—</option><option value="true">true</option><option value="false">false</option>
              </select>
            </label>
            <label className="aria-state-field">
              Expanded
              <select className="detail-select" value={triState(step.selectors.role?.expanded)} onChange={(e) => updateRoleFlag("expanded", e.target.value)}>
                <option value="">—</option><option value="true">true</option><option value="false">false</option>
              </select>
            </label>
            <label className="aria-state-field">
              Selected
              <select className="detail-select" value={triState(step.selectors.role?.selected)} onChange={(e) => updateRoleFlag("selected", e.target.value)}>
                <option value="">—</option><option value="true">true</option><option value="false">false</option>
              </select>
            </label>
            <label className="aria-state-field">
              Exact name
              <select className="detail-select" value={triState(step.selectors.role?.exact)} onChange={(e) => updateRoleFlag("exact", e.target.value)}>
                <option value="">—</option><option value="true">true</option><option value="false">false</option>
              </select>
            </label>
          </div>

          {/* Anchor — "the row where Name contains …" */}
          <label className="detail-sublabel">Anchor (relative match)</label>
          <div className="selector-row">
            <input className="detail-input-sm" value={step.selectors.anchor?.scopeRole ?? ""} onChange={(e) => updateAnchor({ scopeRole: e.target.value || undefined })} placeholder="row" />
            <input className="detail-input" value={step.selectors.anchor?.text ?? ""} onChange={(e) => updateAnchor({ text: e.target.value || undefined })} placeholder="Anchor text (e.g. michael.chen@…)" />
          </div>
          <small className="detail-hint">Scopes the match to the container (e.g. table row) whose text contains the anchor — robust for tables/lists.</small>

          {(step.selectors.nth !== undefined || step.frameSelector) ? (
            <small className="detail-hint">
              {step.selectors.nth !== undefined ? <>Match index: <code>nth({step.selectors.nth})</code> </> : null}
              {step.frameSelector ? <>· In frame: <code>{step.frameSelector}</code></> : null}
            </small>
          ) : null}
        </div>
      ) : null}

      {/* Compound guard — run this step only if the predicate holds */}
      {!isIf && capabilities.canEditConditions ? (
        <div className="detail-section">
          <label className="detail-label">Condition (guard)</label>
          {step.guard ? (
            <>
              <PredicateEditor value={step.guard} onChange={(guard: Predicate) => onUpdate({ ...step, guard })} />
              <label className="detail-sublabel">When false</label>
              <select
                className="detail-select"
                value={step.guardElse ?? "skip"}
                onChange={(e) => updateField("guardElse", e.target.value as RecordedActionView["guardElse"])}
              >
                <option value="skip">Skip this step</option>
                <option value="skipAccount">Skip the whole account</option>
              </select>
              <button className="tertiary-button" onClick={() => onUpdate({ ...step, guard: undefined, guardElse: undefined })}>
                Remove guard
              </button>
            </>
          ) : (
            <button className="step-add-btn" onClick={() => onUpdate({ ...step, guard: { kind: "textVisible", text: "" } })}>
              + Add condition
            </button>
          )}
        </div>
      ) : null}

      {/* Behavior / policy */}
      {!isIf && capabilities.canEditPolicies ? (
        <div className="detail-section">
          <label className="detail-label">Behavior</label>
          <div className="detail-grid two">
            <div>
              <label className="detail-sublabel">Timeout</label>
              <input className="detail-input-sm" type="number" min={500} max={60000} step={500} value={step.timeout ?? 10000} onChange={(e) => updateField("timeout", Number(e.target.value) || 10000)} />
            </div>
            <div>
              <label className="detail-sublabel">Retries</label>
              <input className="detail-input-sm" type="number" min={0} max={10} value={step.retryCount ?? 0} onChange={(e) => updateField("retryCount", Number(e.target.value) || 0)} />
            </div>
            <div>
              <label className="detail-sublabel">Retry delay</label>
              <input className="detail-input-sm" type="number" min={0} max={60000} step={250} value={step.retryDelayMs ?? 1000} onChange={(e) => updateField("retryDelayMs", Number(e.target.value) || 1000)} />
            </div>
            {capabilities.canEditConditions ? (
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
            ) : null}
          </div>
          {capabilities.canEditConditions && step.condition ? (
            <input
              className="detail-input"
              value={step.condition.text ?? ""}
              onChange={(e) => updateField("condition", { ...step.condition!, text: e.target.value, selector: step.selectors })}
              placeholder="Condition text"
            />
          ) : null}
          <div className="detail-toggles">
            <label className="toggle-row">
              <input type="checkbox" checked={step.continueOnFailure ?? false} onChange={(e) => updateField("continueOnFailure", e.target.checked)} />
              <span>Continue on failure</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={step.screenshotOnFailure ?? false} onChange={(e) => updateField("screenshotOnFailure", e.target.checked)} />
              <span>Screenshot on failure</span>
            </label>
          </div>
        </div>
      ) : null}

      {/* Advanced: network wait */}
      {(step.type === "click" || step.networkWaitUrl) ? (
        <div className="detail-section">
          <label className="detail-label">Advanced</label>
          <label className="detail-sublabel">Wait for response (URL fragment)</label>
          <input
            className="detail-input mono"
            value={step.networkWaitUrl ?? ""}
            onChange={(e) => updateField("networkWaitUrl", e.target.value || undefined)}
            placeholder="/api/save"
          />
        </div>
      ) : null}

      {/* Parameters detected */}
      {step.parameterHints && step.parameterHints.length > 0 ? (
        <div className="detail-section">
          <label className="detail-label">Detected Parameters</label>
          <div className="detail-params">
            {step.parameterHints.map((hint, i) => (
              <div key={i} className="detail-param-row">
                <code>{`{{${hint.suggestedName}}}`}</code>
                <span className="detail-param-original">← {hint.originalValue}</span>
                {capabilities.canManageParameters ? (
                  <button
                    className={`detail-param-toggle ${hint.confirmed !== false ? "confirmed" : "dismissed"}`}
                    onClick={() => toggleParameter(i)}
                    title={hint.confirmed !== false ? "Dismiss parameter" : "Confirm parameter"}
                  >
                    {hint.confirmed !== false ? "✓" : "×"}
                  </button>
                ) : (
                  <span className={`detail-param-status ${hint.confirmed !== false ? "confirmed" : "dismissed"}`}>
                    {hint.confirmed !== false ? "✓" : "×"}
                  </span>
                )}
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
