/**
 * Zod schema for RecordedWorkflow. Used by the server to validate imported and
 * edited workflows, and available to any surface that needs runtime validation.
 * The static source of truth remains `types.ts`; this mirrors it for runtime.
 */
import { z } from "zod";
import type { RecordedWorkflow } from "./types.js";

const selectorSchema = z
  .object({
    role: z
      .object({
        role: z.string(),
        name: z.string().optional(),
        exact: z.boolean().optional(),
        checked: z.boolean().optional(),
        expanded: z.boolean().optional(),
        selected: z.boolean().optional(),
        pressed: z.boolean().optional()
      })
      .loose()
      .optional(),
    label: z.string().optional(),
    text: z.string().optional(),
    testId: z.string().optional(),
    css: z.string().optional(),
    xpath: z.string().optional(),
    nth: z.number().optional(),
    anchor: z
      .object({
        text: z.string().optional(),
        scopeRole: z.string().optional(),
        scopeSelector: z.string().optional(),
        kind: z.enum(["row", "listitem", "dialog", "form", "section", "formField", "heading", "custom"]).optional(),
        relationship: z.enum(["within", "near", "nearControl", "rightOf", "leftOf", "above", "below"]).optional()
      })
      .loose()
      .optional()
  })
  .loose();

const selectorDiagnosticsSchema = z
  .object({
    matchedCount: z.number().optional(),
    visibleCount: z.number().optional(),
    chosenPreview: z.string().optional(),
    uniquelyIdentifiesTarget: z.boolean().optional(),
    anchorReducedMatches: z.boolean().optional(),
    brittleReason: z.string().optional(),
    context: z
      .object({
        appliedAutomatically: z.boolean(),
        mode: z.enum(["primary", "fallback", "diagnostic"]),
        reason: z.string(),
        directMatchedCount: z.number(),
        directVisibleCount: z.number(),
        contextMatchedCount: z.number(),
        contextVisibleCount: z.number()
      })
      .loose()
      .optional()
  })
  .loose();

const selectorCandidateSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["role", "label", "testId", "text", "css", "xpath", "relative", "zoomComponent"]),
    selector: selectorSchema,
    source: z.enum(["recorded", "legacy", "manual", "healed", "generated"]).optional(),
    label: z.string().optional(),
    diagnostics: selectorDiagnosticsSchema.optional()
  })
  .loose();

const selectorCandidateScoreSchema = z
  .object({
    score: z.number(),
    level: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.string())
  })
  .loose();

const stepCaptureSchema = z
  .object({
    thumbnail: z
      .object({
        dataUrl: z.string(),
        width: z.number(),
        height: z.number()
      })
      .loose()
      .optional(),
    screenshotArtifactId: z.string().optional(),
    capturedAt: z.string(),
    pageUrl: z.string(),
    viewport: z
      .object({
        width: z.number(),
        height: z.number()
      })
      .loose(),
    targetBox: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number()
      })
      .loose()
      .optional()
  })
  .loose();

const selectorDiagnosticsSummarySchema = z
  .object({
    matchedCount: z.number(),
    visibleCount: z.number(),
    chosenCandidateId: z.string().optional(),
    confidence: selectorCandidateScoreSchema,
    targetPreview: z.string().optional(),
    anchor: z
      .object({
        text: z.string().optional(),
        scopeRole: z.string().optional(),
        scopeSelector: z.string().optional(),
        kind: z.enum(["row", "listitem", "dialog", "form", "section", "formField", "heading", "custom"]).optional(),
        relationship: z.enum(["within", "near", "nearControl", "rightOf", "leftOf", "above", "below"]).optional(),
        resolved: z.boolean()
      })
      .loose()
      .optional(),
    context: z
      .object({
        appliedAutomatically: z.boolean(),
        mode: z.enum(["primary", "fallback", "diagnostic"]),
        reason: z.string(),
        directMatchedCount: z.number(),
        directVisibleCount: z.number(),
        contextMatchedCount: z.number(),
        contextVisibleCount: z.number()
      })
      .loose()
      .optional()
  })
  .loose();

const selectorRepairSuggestionSchema = z
  .object({
    candidateId: z.string(),
    selector: selectorSchema,
    source: z.enum(["recorded", "legacy", "manual", "healed", "generated"]),
    score: selectorCandidateScoreSchema,
    matchedCount: z.number(),
    visibleCount: z.number(),
    risk: z.enum(["low", "medium", "high"])
  })
  .loose();

const selectMetadataSchema = z
  .object({
    targetCandidates: z.array(selectorCandidateSchema).optional(),
    optionCandidates: z.array(selectorCandidateSchema).optional(),
    optionLabel: z.string().optional(),
    optionValue: z.string().optional(),
    popupSelectorHint: selectorSchema.optional(),
    verificationText: z.string().optional()
  })
  .loose();

const conditionSchema = z
  .object({
    type: z.enum(["none", "textExistsSkip", "elementVisibleClick", "fieldEmptyFill", "addressAlreadyExistsSkipAccount", "entityStateGuard"]),
    text: z.string().optional(),
    selector: selectorSchema.optional(),
    operation: z.enum(["create", "update", "delete", "assign", "remove", "verify", "unknown"]).optional(),
    entityKind: z.string().optional(),
    match: z
      .object({
        allText: z.array(z.string()).optional(),
        anyText: z.array(z.string()).optional()
      })
      .loose()
      .optional(),
    whenMatched: z.enum(["skipStep", "skipAccount"]).optional(),
    whenMissing: z.enum(["skipStep", "skipAccount"]).optional()
  })
  .loose();

// Recursive predicate tree (shared by step guards and IF blocks).
const predicateSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("always") }).loose(),
    z.object({ kind: z.enum(["and", "or"]), operands: z.array(predicateSchema) }).loose(),
    z.object({ kind: z.literal("not"), operand: predicateSchema }).loose(),
    z.object({ kind: z.literal("textVisible"), text: z.string() }).loose(),
    z.object({ kind: z.literal("elementVisible"), selector: selectorSchema }).loose(),
    z.object({ kind: z.literal("fieldEmpty"), selector: selectorSchema }).loose(),
    z.object({ kind: z.literal("fieldValue"), selector: selectorSchema, equals: z.string().optional(), contains: z.string().optional() }).loose(),
    z.object({ kind: z.literal("urlContains"), text: z.string() }).loose()
  ])
);

const parameterHintSchema = z
  .object({
    originalValue: z.string(),
    suggestedName: z.string(),
    reason: z.string(),
    confirmed: z.boolean().optional()
  })
  .loose();

const intentTypeSchema = z.enum([
  "zoom.selectComboboxOption",
  "zoom.fillFieldByLabel",
  "zoom.clickPrimaryAction",
  "zoom.selectTableRows",
  "zoom.verifyEntityExists",
  "zoom.skipIfEntityExists"
]);

const intentMetadataSchema = z
  .object({
    fieldLabel: z.string().optional(),
    optionLabel: z.string().optional(),
    tableEntityKind: z.string().optional(),
    rowMatchText: z.string().optional(),
    rowMatchPattern: z.string().optional(),
    rowCount: z.number().optional(),
    expectedOutcome: z.string().optional(),
    mutationBoundary: z.boolean().optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    source: z.enum(["recorded", "hardened", "manual"]).optional()
  })
  .loose();

const actionSchema: z.ZodType = z.lazy(() => z
  .object({
    id: z.string(),
    timestamp: z.number(),
    type: z.enum([
      "click", "fill", "select", "selectRows", "navigate", "upload", "wait",
      "assert", "screenshot", "dismiss", "hover", "press", "download", "dialog", "if"
    ]),
    selectors: selectorSchema,
    selectorCandidates: z.array(selectorCandidateSchema).optional(),
    selectedCandidateId: z.string().optional(),
    selectMetadata: selectMetadataSchema.optional(),
    rowSelection: z
      .object({
        mode: z.literal("firstAvailable"),
        count: z.number().int().positive(),
        entityKind: z.string().optional(),
        outputName: z.string().optional(),
        rowSelector: z.string().optional(),
        checkboxSelector: z.string().optional(),
        valuePattern: z.string().optional(),
        unavailableText: z.string().optional(),
        minimumCount: z.number().int().positive().optional()
      })
      .loose()
      .optional(),
    capture: stepCaptureSchema.optional(),
    selectorDiagnostics: selectorDiagnosticsSummarySchema.optional(),
    repairSuggestions: z.array(selectorRepairSuggestionSchema).optional(),
    value: z.string().optional(),
    url: z.string().optional(),
    filePath: z.string().optional(),
    assertionType: z
      .enum([
        "textVisible", "elementVisible", "urlContains", "urlMatches", "fieldValue",
        "tableRowContains", "addressStatusEquals", "toastVisible", "hasText", "hasValue",
        "entityExists", "entityAbsent", "entityState"
      ])
      .optional(),
    expected: z.string().optional(),
    timeout: z.number().optional(),
    onFailure: z.enum(["fail", "retry", "skip", "screenshot"]).optional(),
    retryCount: z.number().optional(),
    retryDelayMs: z.number().optional(),
    continueOnFailure: z.boolean().optional(),
    screenshotOnFailure: z.boolean().optional(),
    condition: conditionSchema.optional(),
    guard: predicateSchema.optional(),
    guardElse: z.enum(["skip", "skipAccount"]).optional(),
    screenshotLabel: z.string().optional(),
    waitMs: z.number().optional(),
    selectorNote: z.string().optional(),
    pageUrl: z.string(),
    pageTitle: z.string(),
    frameSelector: z.string().optional(),
    parameterHints: z.array(parameterHintSchema).optional(),
    description: z.string().optional(),
    key: z.string().optional(),
    ariaState: z
      .object({ checked: z.boolean().optional(), expanded: z.boolean().optional(), selected: z.boolean().optional() })
      .optional(),
    networkWaitUrl: z.string().optional(),
    waitForUrl: z.string().optional(),
    dialogAction: z.enum(["accept", "dismiss"]).optional(),
    dialogPromptText: z.string().optional(),
    elementScreenshot: z.boolean().optional(),
    sideEffectRisk: z.enum(["read", "edit", "mutation", "destructive"]).optional(),
    skipInDryRun: z.boolean().optional(),
    intentType: intentTypeSchema.optional(),
    intentMetadata: intentMetadataSchema.optional(),
    ifCondition: predicateSchema.optional(),
    thenActions: z.array(actionSchema).optional(),
    elseActions: z.array(actionSchema).optional()
  })
  .loose());

const parameterSchema = z
  .object({
    name: z.string(),
    type: z.enum(["string", "number", "file", "select"]),
    required: z.boolean(),
    description: z.string(),
    defaultValue: z.string().optional(),
    options: z.array(z.string()).optional(),
    source: z.enum(["addressProfile", "config", "env", "account", "prompt"]),
    ui: z
      .object({
        group: z.string().optional(),
        label: z.string().optional(),
        helpText: z.string().optional(),
        placeholder: z.string().optional(),
        secret: z.boolean().optional(),
        multiline: z.boolean().optional(),
        fileAccept: z.string().optional(),
        accountOverrideAllowed: z.boolean().optional()
      })
      .loose()
      .optional()
  })
  .loose();

const assertionSchema = z
  .object({
    afterAction: z.string(),
    type: z.enum([
      "urlContains", "urlMatches", "textVisible", "elementVisible", "responseOk",
      "fieldValue", "tableRowContains", "addressStatusEquals", "toastVisible",
      "entityExists", "entityAbsent", "entityState"
    ]),
    expected: z.string(),
    timeout: z.number(),
    onFailure: z.enum(["fail", "retry", "skip", "screenshot"])
  })
  .loose();

export const workflowSchema = z
  .object({
    version: z.literal(1),
    meta: z
      .object({
        name: z.string(),
        description: z.string(),
        recordedAt: z.string(),
        recordedOnUrl: z.string(),
        recordedByEmail: z.string().optional(),
        durationMs: z.number(),
        category: z.enum(["phone", "settings", "compliance", "custom"])
      })
      .loose(),
    parameters: z.array(parameterSchema),
    actions: z.array(actionSchema).min(1),
    assertions: z.array(assertionSchema),
    config: z
      .object({
        startUrl: z.string(),
        requiresImpersonation: z.boolean(),
        defaultTimeout: z.number(),
        retryableErrors: z.array(z.string())
      })
      .loose(),
    quality: z.unknown().optional()
  })
  .loose();

/** Validate and return a typed workflow. Throws ZodError on failure. */
export function parseWorkflow(data: unknown): RecordedWorkflow {
  return workflowSchema.parse(data) as unknown as RecordedWorkflow;
}

export type WorkflowValidationResult =
  | { success: true; workflow: RecordedWorkflow }
  | { success: false; error: string };

/** Validate without throwing; returns a flattened error message on failure. */
export function safeParseWorkflow(data: unknown): WorkflowValidationResult {
  const result = workflowSchema.safeParse(data);
  if (result.success) {
    return { success: true, workflow: result.data as unknown as RecordedWorkflow };
  }
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { success: false, error: `Invalid workflow: ${issues}` };
}
