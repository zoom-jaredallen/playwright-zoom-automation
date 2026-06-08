import type { RecordedAction, WorkflowAssertion } from "../types.js";
import { analyzeWorkflowIntent } from "./intent.js";
import { buildEntityModel } from "./entity.js";
import { flattenActionTree } from "./actionText.js";
import type { ApplicationAdapter } from "./adapters.js";
import type { EntityModel, WorkflowIntentAnalysis } from "./types.js";

export interface WorkflowHardeningReport {
  bulkReady: boolean;
  intent: WorkflowIntentAnalysis;
  entity: EntityModel;
  addedGuardActionId?: string;
  addedAssertion?: WorkflowAssertion;
  mutationRetryDisabledActionIds: string[];
  warnings: string[];
}

export interface HardenRecordedWorkflowInput {
  actions: RecordedAction[];
  assertions?: WorkflowAssertion[];
  adapter?: ApplicationAdapter;
}

export interface HardenRecordedWorkflowResult {
  actions: RecordedAction[];
  assertions: WorkflowAssertion[];
  analysis: WorkflowIntentAnalysis;
  entity: EntityModel;
  report: WorkflowHardeningReport;
}

export function hardenRecordedWorkflow(input: HardenRecordedWorkflowInput): HardenRecordedWorkflowResult {
  const collapsedInputActions = applyFormFieldAnchors(collapseDynamicRowSelections(input.actions));
  const analysis = analyzeWorkflowIntent(collapsedInputActions);
  const baseEntity = buildEntityModel(collapsedInputActions, analysis);
  const entity = input.adapter?.enhanceEntityModel({ entity: baseEntity, actions: collapsedInputActions, analysis }) ?? baseEntity;
  let assertions = [...(input.assertions ?? [])];
  const mutationRetryDisabledActionIds: string[] = [];
  let addedGuardActionId: string | undefined;
  let addedAssertion: WorkflowAssertion | undefined;

  let actions = pruneUnsafeEntityStateGuards(collapsedInputActions.map(cloneAction), entity);

  if (analysis.requiresIdempotency && entity.fingerprintFields.length > 0 && canBuildPreflightGuard(entity)) {
    const guardTargetId = firstGuardTargetId(analysis) ?? analysis.mutationStepIds[0];
    if (guardTargetId) {
      const nextGuard = {
        type: "entityStateGuard" as const,
        operation: entity.operation,
        entityKind: entity.entityKind,
        match: { allText: fingerprintValues(entity) },
        whenMatched: operationMatchedBehavior(entity.operation)
      };
      actions = updateAction(actions, guardTargetId, (action) => ({
        ...action,
        condition: shouldReplaceEntityGuard(action.condition, nextGuard) ? nextGuard : action.condition ?? nextGuard
      }));
      addedGuardActionId = guardTargetId;
    }
  }

  for (const risk of analysis.stepRisks) {
    actions = updateAction(actions, risk.actionId, (action) => ({
      ...action,
      sideEffectRisk: risk.risk
    }));
    if (risk.risk !== "mutation" && risk.risk !== "destructive") continue;
    actions = updateAction(actions, risk.actionId, (action) => ({
      ...action,
      retryCount: 0,
      continueOnFailure: false,
      screenshotOnFailure: true,
      sideEffectRisk: risk.risk
    }));
    mutationRetryDisabledActionIds.push(risk.actionId);
  }

  const lastMutationActionId = analysis.mutationStepIds.at(-1);
  const mutationActionIds = new Set(analysis.mutationStepIds);
  assertions = assertions.filter((assertion) => !isWeakGeneratedCommitAssertion(assertion) || mutationActionIds.has(assertion.afterAction));
  if (lastMutationActionId && entity.fingerprintFields.length > 0) {
    assertions = assertions.filter((assertion) => {
      if (isWeakGeneratedCommitAssertion(assertion, lastMutationActionId)) return false;
      if (isStaleEntityAssertion(assertion, lastMutationActionId, entity)) return false;
      return true;
    });
  }

  if (lastMutationActionId && entity.fingerprintFields.length > 0 && !assertions.some((assertion) => assertion.afterAction === lastMutationActionId)) {
    addedAssertion = buildOutcomeAssertion(lastMutationActionId, entity);
    assertions.push(addedAssertion);
  }

  const warnings = [
    ...entity.warnings,
    analysis.intent === "unknown" ? "Workflow intent could not be inferred." : undefined,
    !addedGuardActionId && analysis.requiresIdempotency ? "No idempotency guard could be generated." : undefined,
    !addedAssertion && analysis.requiresOutcomeAssertion ? "No outcome assertion could be generated." : undefined
  ].filter(Boolean) as string[];

  actions = actions.map(annotateIntentMetadata);

  return {
    actions,
    assertions,
    analysis,
    entity,
    report: {
      bulkReady: warnings.length === 0 && analysis.confidence !== "low" && entity.confidence !== "low",
      intent: analysis,
      entity,
      addedGuardActionId,
      addedAssertion,
      mutationRetryDisabledActionIds,
      warnings
    }
  };
}

function annotateIntentMetadata(action: RecordedAction): RecordedAction {
  if (action.intentType) return action;

  if (action.type === "select") {
    const fieldLabel = inferFormFieldLabel(action);
    const optionLabel = action.selectMetadata?.optionLabel ?? action.value;
    return {
      ...action,
      intentType: "zoom.selectComboboxOption",
      intentMetadata: {
        fieldLabel,
        optionLabel,
        confidence: fieldLabel && optionLabel ? "high" : "medium",
        source: "hardened"
      }
    };
  }

  if (action.type === "fill") {
    const fieldLabel = inferFormFieldLabel(action);
    return {
      ...action,
      intentType: "zoom.fillFieldByLabel",
      intentMetadata: {
        fieldLabel,
        expectedOutcome: action.value,
        confidence: fieldLabel ? "high" : "medium",
        source: "hardened"
      }
    };
  }

  if (action.type === "selectRows" && action.rowSelection) {
    return {
      ...action,
      intentType: "zoom.selectTableRows",
      intentMetadata: {
        tableEntityKind: action.rowSelection.entityKind,
        rowCount: action.rowSelection.count,
        rowMatchPattern: action.rowSelection.valuePattern,
        confidence: "high",
        source: "hardened"
      }
    };
  }

  if (action.type === "click" && (action.sideEffectRisk === "mutation" || action.sideEffectRisk === "destructive" || action.networkWaitUrl)) {
    return {
      ...action,
      intentType: "zoom.clickPrimaryAction",
      intentMetadata: {
        expectedOutcome: action.selectors.role?.name ?? action.selectors.text ?? action.description,
        mutationBoundary: action.sideEffectRisk === "mutation" || action.sideEffectRisk === "destructive" || Boolean(action.networkWaitUrl),
        confidence: action.selectors.role?.name ? "high" : "medium",
        source: "hardened"
      }
    };
  }

  if (action.condition?.type === "entityStateGuard" && action.condition.whenMatched === "skipAccount") {
    return {
      ...action,
      intentType: "zoom.skipIfEntityExists",
      intentMetadata: {
        tableEntityKind: action.condition.entityKind,
        expectedOutcome: action.condition.match?.allText?.join("|") ?? action.condition.match?.anyText?.join("|"),
        confidence: "medium",
        source: "hardened"
      }
    };
  }

  return action;
}

function collapseDynamicRowSelections(actions: RecordedAction[]): RecordedAction[] {
  const result: RecordedAction[] = [];
  for (let index = 0; index < actions.length; index++) {
    const run = collectPhoneCheckboxRun(actions, index);
    if (run.length >= 2) {
      const first = run[0];
      result.push({
        ...first,
        type: "selectRows",
        selectors: {},
        selectorCandidates: undefined,
        selectedCandidateId: undefined,
        ariaState: undefined,
        condition: undefined,
        rowSelection: {
          mode: "firstAvailable",
          count: run.length,
          minimumCount: run.length,
          entityKind: "phoneNumber",
          outputName: "selected.phoneNumbers",
          rowSelector: "tr, [role='row'], .zcc-compat-zoom-virtual-table__row, .zcc-compat-zoom-table__row, .zcc-compat-zoom-table-row, .zcc-compat-zoom-table__body-row",
          checkboxSelector: "[role='checkbox'], input[type='checkbox'], [class*='checkbox'], [class*='Checkbox'], [class*='cpzui-checkbox']",
          valuePattern: "\\+\\d[\\d\\s().-]{5,}",
          unavailableText: "Unavailable|Reserved|Assigned|In use|Unavailable"
        },
        description: `Select first ${run.length} available phone-number rows`
      });
      index += run.length - 1;
      continue;
    }
    result.push(actions[index]);
  }
  return result;
}

function applyFormFieldAnchors(actions: RecordedAction[]): RecordedAction[] {
  return actions.map((action) => {
    const anchored = applyFormFieldAnchor(action);
    if (anchored.type !== "if") return anchored;
    return {
      ...anchored,
      thenActions: anchored.thenActions ? applyFormFieldAnchors(anchored.thenActions) : anchored.thenActions,
      elseActions: anchored.elseActions ? applyFormFieldAnchors(anchored.elseActions) : anchored.elseActions
    };
  });
}

function applyFormFieldAnchor(action: RecordedAction): RecordedAction {
  if (!["fill", "select"].includes(action.type)) return action;
  const label = inferFormFieldLabel(action);
  if (!label || action.selectors.anchor) return action;

  const anchor = {
    text: label,
    scopeSelector: ".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']",
    kind: "formField" as const,
    relationship: "nearControl" as const
  };

  return {
    ...action,
    selectors: { ...action.selectors, anchor },
    selectorCandidates: action.selectorCandidates?.map((candidate) => ({
      ...candidate,
      selector: shouldAnchorCandidate(candidate.selector)
        ? { ...candidate.selector, anchor: candidate.selector.anchor ?? anchor }
        : candidate.selector
    })),
    selectMetadata: action.selectMetadata
      ? {
          ...action.selectMetadata,
          targetCandidates: action.selectMetadata.targetCandidates?.map((candidate) => ({
            ...candidate,
            selector: shouldAnchorCandidate(candidate.selector)
              ? { ...candidate.selector, anchor: candidate.selector.anchor ?? anchor }
              : candidate.selector
          }))
        }
      : action.selectMetadata
  };
}

function inferFormFieldLabel(action: RecordedAction): string | undefined {
  const direct = action.selectors.label ?? action.selectors.role?.name;
  if (direct) return direct;
  for (const candidate of action.selectorCandidates ?? []) {
    const label = candidate.selector.label ?? candidate.selector.role?.name;
    if (label) return label;
  }
  return undefined;
}

function shouldAnchorCandidate(selector: RecordedAction["selectors"]): boolean {
  if (selector.anchor) return true;
  if (selector.label) return true;
  if (selector.role?.role && ["combobox", "textbox", "searchbox"].includes(selector.role.role)) return true;
  if (selector.css || selector.xpath) return true;
  return false;
}

function collectPhoneCheckboxRun(actions: RecordedAction[], startIndex: number): RecordedAction[] {
  const run: RecordedAction[] = [];
  for (let index = startIndex; index < actions.length; index++) {
    const action = actions[index];
    if (!isPhoneCheckboxClick(action)) break;
    run.push(action);
  }
  return run;
}

function isPhoneCheckboxClick(action: RecordedAction): boolean {
  if (action.type !== "click") return false;
  if (action.selectors.role?.role !== "checkbox" && !/checkbox/i.test(action.description ?? "")) return false;
  const text = [
    action.selectors.anchor?.text,
    action.selectors.role?.name,
    action.selectors.text,
    action.description
  ].filter(Boolean).join(" ");
  return /\+\d[\d\s().-]{5,}/.test(text);
}

function isWeakGeneratedCommitAssertion(assertion: WorkflowAssertion, actionId?: string): boolean {
  return (actionId === undefined || assertion.afterAction === actionId)
    && assertion.type === "textVisible"
    && /^success\|saved\|added\|submitted$/i.test(assertion.expected.trim());
}

function isStaleEntityAssertion(assertion: WorkflowAssertion, actionId: string, entity: EntityModel): boolean {
  if (assertion.afterAction !== actionId) return false;
  if (!["entityExists", "entityAbsent", "entityState"].includes(assertion.type)) return false;
  return assertion.expected !== fingerprintValues(entity).join("|");
}

function buildOutcomeAssertion(afterAction: string, entity: EntityModel): WorkflowAssertion {
  const expected = fingerprintValues(entity).join("|");
  return {
    afterAction,
    type: entity.operation === "delete" || entity.operation === "remove" ? "entityAbsent" : "entityExists",
    expected,
    timeout: 15_000,
    onFailure: "screenshot"
  };
}

function firstGuardTargetId(analysis: WorkflowIntentAnalysis): string | undefined {
  return analysis.entryStepIds[0] ?? analysis.mutationStepIds[0];
}

function operationMatchedBehavior(operation: EntityModel["operation"]): "skipAccount" | "skipStep" {
  return operation === "create" || operation === "assign" || operation === "update" ? "skipAccount" : "skipStep";
}

function canBuildPreflightGuard(entity: EntityModel): boolean {
  return !fingerprintValues(entity).some((value) => /\{\{\s*selected\./.test(value));
}

function pruneUnsafeEntityStateGuards(actions: RecordedAction[], entity: EntityModel): RecordedAction[] {
  return actions.map((action) => {
    const nextAction = action.type === "if"
      ? {
          ...action,
          thenActions: action.thenActions ? pruneUnsafeEntityStateGuards(action.thenActions, entity) : action.thenActions,
          elseActions: action.elseActions ? pruneUnsafeEntityStateGuards(action.elseActions, entity) : action.elseActions
        }
      : action;

    if (!nextAction.condition || nextAction.condition.type !== "entityStateGuard") return nextAction;
    if (!canReuseEntityGuard(nextAction.condition, entity)) {
      const { condition: _condition, ...withoutCondition } = nextAction;
      return withoutCondition;
    }
    return nextAction;
  });
}

function canReuseEntityGuard(condition: NonNullable<RecordedAction["condition"]>, entity: EntityModel): boolean {
  if (condition.type !== "entityStateGuard") return true;
  if (!canBuildPreflightGuard(entity)) return false;
  if (condition.entityKind !== entity.entityKind || condition.operation !== entity.operation) return false;
  const expectedValues = fingerprintValues(entity);
  const existingValues = condition.match?.allText ?? [];
  return existingValues.length === expectedValues.length
    && existingValues.every((value, index) => value === expectedValues[index]);
}

function shouldReplaceEntityGuard(
  existing: RecordedAction["condition"],
  next: NonNullable<RecordedAction["condition"]>
): boolean {
  if (!existing || existing.type !== "entityStateGuard" || next.type !== "entityStateGuard") return false;
  if (existing.entityKind !== next.entityKind || existing.operation !== next.operation) return true;
  const existingValues = existing.match?.allText ?? [];
  const nextValues = next.match?.allText ?? [];
  if (existingValues.some((value) => /^(expanded|collapsed)$/i.test(value))) return true;
  return existingValues.join("\u0000") !== nextValues.join("\u0000");
}

function fingerprintValues(entity: EntityModel): string[] {
  return entity.fingerprintFields.map((field) => field.value);
}

function updateAction(actions: RecordedAction[], actionId: string, updater: (action: RecordedAction) => RecordedAction): RecordedAction[] {
  return actions.map((action) => {
    if (action.id === actionId) return updater(action);
    if (action.type !== "if") return action;
    return {
      ...action,
      thenActions: action.thenActions ? updateAction(action.thenActions, actionId, updater) : action.thenActions,
      elseActions: action.elseActions ? updateAction(action.elseActions, actionId, updater) : action.elseActions
    };
  });
}

function cloneAction(action: RecordedAction): RecordedAction {
  const [clone] = flattenActionTree([structuredClone(action)]);
  return clone;
}
