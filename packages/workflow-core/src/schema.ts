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
    nth: z.number().optional(),
    anchor: z
      .object({
        text: z.string().optional(),
        scopeRole: z.string().optional(),
        relationship: z.enum(["within", "near", "rightOf", "leftOf", "above", "below"]).optional()
      })
      .loose()
      .optional()
  })
  .loose();

const conditionSchema = z
  .object({
    type: z.enum(["none", "textExistsSkip", "elementVisibleClick", "fieldEmptyFill", "addressAlreadyExistsSkipAccount"]),
    text: z.string().optional(),
    selector: selectorSchema.optional()
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

const actionSchema: z.ZodType = z.lazy(() => z
  .object({
    id: z.string(),
    timestamp: z.number(),
    type: z.enum([
      "click", "fill", "select", "navigate", "upload", "wait",
      "assert", "screenshot", "dismiss", "hover", "press", "download", "dialog", "if"
    ]),
    selectors: selectorSchema,
    value: z.string().optional(),
    url: z.string().optional(),
    filePath: z.string().optional(),
    assertionType: z
      .enum(["textVisible", "elementVisible", "urlContains", "fieldValue", "tableRowContains", "hasText", "hasValue"])
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
    source: z.enum(["addressProfile", "config", "env", "account", "prompt"])
  })
  .loose();

const assertionSchema = z
  .object({
    afterAction: z.string(),
    type: z.enum(["urlContains", "textVisible", "elementVisible", "responseOk", "fieldValue"]),
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
