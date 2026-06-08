/**
 * Framework-agnostic analysis of recorded workflows: parameter extraction,
 * assertion generation, quality scoring, and value parameter detection.
 * Lifted from the extension service-worker and parameterizer so the Web UI,
 * server, and extension all compute identical results.
 */
import type {
  AssertionType,
  ParameterHint,
  RecordedAction,
  WorkflowAssertion,
  WorkflowCategory,
  WorkflowParameter,
  WorkflowQualityReport
} from "./types.js";

/**
 * Depth-first flatten of an action tree (descends into IF then/else branches).
 * Local copy to avoid a circular import with model.ts (which imports this module).
 */
function flatten(actions: RecordedAction[]): RecordedAction[] {
  const out: RecordedAction[] = [];
  for (const action of actions) {
    out.push(action);
    if (action.type === "if") {
      if (action.thenActions) out.push(...flatten(action.thenActions));
      if (action.elseActions) out.push(...flatten(action.elseActions));
    }
  }
  return out;
}

// ─── Parameter extraction ─────────────────────────────────────────────────────

export function extractParameters(actionTree: RecordedAction[]): WorkflowParameter[] {
  const actions = flatten(actionTree);
  const paramMap = new Map<string, WorkflowParameter>();

  for (const action of actions) {
    if (!action.parameterHints) continue;
    for (const hint of action.parameterHints) {
      if (hint.confirmed === false) continue; // User explicitly dismissed
      if (paramMap.has(hint.suggestedName)) continue;

      paramMap.set(hint.suggestedName, {
        name: hint.suggestedName,
        type: "string",
        required: true,
        description: `Auto-detected: ${hint.reason.replace(/_/g, " ")}`,
        defaultValue: undefined,
        source: inferParameterSource(hint.suggestedName)
      });
    }
  }

  return Array.from(paramMap.values());
}

function inferParameterSource(paramName: string): WorkflowParameter["source"] {
  if (paramName.startsWith("address.")) return "addressProfile";
  if (paramName === "customerName") return "addressProfile";
  if (paramName.startsWith("contact.")) return "addressProfile";
  if (paramName === "contactEmail") return "addressProfile";
  if (paramName === "phoneNumber") return "config";
  return "prompt";
}

export function replaceWithPlaceholders(action: RecordedAction): string | undefined {
  if (!action.value || !action.parameterHints) return action.value;

  let value = action.value;
  for (const hint of action.parameterHints) {
    if (hint.confirmed === false) continue;
    value = value.replace(hint.originalValue, `{{${hint.suggestedName}}}`);
  }
  return value;
}

// ─── Assertion generation ───────────────────────────────────────────────────────

export function generateAssertions(actionTree: RecordedAction[]): WorkflowAssertion[] {
  const actions = flatten(actionTree);
  const assertions: WorkflowAssertion[] = [];

  for (const action of actions) {
    if (action.type === "assert" && action.expected && action.assertionType) {
      assertions.push({
        afterAction: action.id,
        type: mapAssertionType(action.assertionType),
        expected: action.expected,
        timeout: action.timeout ?? 10_000,
        onFailure: action.onFailure ?? "screenshot"
      });
    }

    // After finalizing clicks, add success assertion. Opening controls such as
    // "Add user" should not be treated as commits because they often open forms
    // or dialogs without showing a toast.
    if (action.type === "click") {
      const name = action.selectors.role?.name ?? action.selectors.text ?? "";
      if (isCommitClickLabel(name)) {
        assertions.push({
          afterAction: action.id,
          type: "textVisible",
          expected: "success|saved|added|submitted",
          timeout: 10_000,
          onFailure: "screenshot"
        });
      }
    }

    // After navigation, assert URL
    if (action.type === "navigate" && action.url) {
      const path = new URL(action.url).hash || new URL(action.url).pathname;
      assertions.push({
        afterAction: action.id,
        type: "urlContains",
        expected: path,
        timeout: 15_000,
        onFailure: "fail"
      });
    }
  }

  return assertions;
}

export function isCommitClickLabel(label: string): boolean {
  return /\b(save|submit|confirm|apply|create|update|finish|done)\b/i.test(label.trim());
}

/** Map a recorded assertion type to the narrower WorkflowAssertion.type union. */
export function mapAssertionType(type: AssertionType): WorkflowAssertion["type"] {
  switch (type) {
    case "hasValue":
      return "fieldValue";
    case "hasText":
      return "textVisible";
    default:
      return type;
  }
}

// ─── Description & category ─────────────────────────────────────────────────────

export function generateDescription(actionTree: RecordedAction[]): string {
  const actions = flatten(actionTree);
  const fills = actions.filter((a) => a.type === "fill").length;
  const clicks = actions.filter((a) => a.type === "click").length;
  const navigations = actions.filter((a) => a.type === "navigate").length;
  const assertions = actions.filter((a) => a.type === "assert").length;
  const screenshots = actions.filter((a) => a.type === "screenshot").length;
  return `Recorded workflow: ${navigations} navigation(s), ${fills} field fill(s), ${clicks} click(s), ${assertions} assertion(s), ${screenshots} screenshot(s).`;
}

export function inferCategory(actions: RecordedAction[]): WorkflowCategory {
  const urls = actions.map((a) => a.pageUrl).join(" ");
  if (/phoneNumbers|business-address|phone/i.test(urls)) return "phone";
  if (/settings|policy|policies/i.test(urls)) return "settings";
  if (/compliance|10dlc|brand/i.test(urls)) return "compliance";
  return "custom";
}

// ─── Quality report ─────────────────────────────────────────────────────────────

export function calculateQualityReport(
  workflowActionTree: RecordedAction[],
  assertions: WorkflowAssertion[]
): WorkflowQualityReport {
  const workflowActions = flatten(workflowActionTree);
  const actionable = workflowActions.filter((action) => !["navigate", "wait", "screenshot", "dismiss", "dialog", "if"].includes(action.type));
  const stableSelectors = actionable.filter(hasStableSelector).length;
  const selectorStability = actionable.length === 0 ? 100 : Math.round((stableSelectors / actionable.length) * 100);
  const submitActions = workflowActions.filter((action) => action.type === "click" && isOutcomeAssertionTarget(action));
  const assertionCoverage = submitActions.length === 0 ? 100 : Math.round((Math.min(assertions.length, submitActions.length) / submitActions.length) * 100);
  const evidenceCount = workflowActions.filter((action) => action.capture || action.type === "screenshot" || action.screenshotOnFailure || action.onFailure === "screenshot").length;
  const evidenceCoverage = workflowActions.length === 0 ? 100 : Math.round((evidenceCount / workflowActions.length) * 100);
  const riskySteps = workflowActions.filter((action) => action.type === "click" && !action.selectors.role?.name && !action.selectors.testId).length;
  const hardcodedValues = workflowActions.filter((action) => (action.value || action.expected || "").length > 0 && !(action.value || action.expected || "").includes("{{")).length;
  const unsupportedBrowserPreflightSteps = workflowActions.filter((action) => action.type === "upload").length;
  const ambiguousWithoutContext = actionable.filter(needsContext).length;
  const penalties = riskySteps * 7 + hardcodedValues * 3 + unsupportedBrowserPreflightSteps * 8;
  const score = Math.max(0, Math.min(100, Math.round((selectorStability * 0.35) + (assertionCoverage * 0.3) + (evidenceCoverage * 0.2) + 15 - penalties)));
  const warnings = [
    selectorStability < 70 ? "Several steps rely on weak selectors." : undefined,
    ambiguousWithoutContext > 0 ? "Add context to selectors that match multiple visible elements." : undefined,
    assertionCoverage < 80 ? "Add validations after important submit/save actions." : undefined,
    evidenceCoverage < 25 ? "Add screenshots for evidence and failure diagnosis." : undefined,
    unsupportedBrowserPreflightSteps > 0 ? "Upload steps cannot be tested by the extension preflight runner." : undefined,
    hardcodedValues > 0 ? "Review hardcoded values and parameterize tenant-specific inputs." : undefined
  ].filter(Boolean) as string[];

  return { score, selectorStability, assertionCoverage, evidenceCoverage, riskySteps, hardcodedValues, unsupportedBrowserPreflightSteps, warnings };
}

function hasStableSelector(action: RecordedAction): boolean {
  if (contextNarrowsToOne(action)) {
    return true;
  }
  if (action.selectorDiagnostics?.confidence.level === "high" && action.selectorDiagnostics.visibleCount === 1) {
    return true;
  }
  return Boolean(action.selectors.role?.name || action.selectors.label || action.selectors.testId);
}

function contextNarrowsToOne(action: RecordedAction): boolean {
  const context = action.selectorDiagnostics?.context;
  return Boolean(context && context.directVisibleCount > 1 && context.contextVisibleCount === 1);
}

function needsContext(action: RecordedAction): boolean {
  const diagnostics = action.selectorDiagnostics;
  if (!diagnostics) return false;
  if (contextNarrowsToOne(action)) return false;
  return (diagnostics.visibleCount ?? 0) > 1 && !action.selectors.anchor?.text;
}

function isOutcomeAssertionTarget(action: RecordedAction): boolean {
  if (action.sideEffectRisk) return action.sideEffectRisk === "mutation" || action.sideEffectRisk === "destructive";
  return isCommitClickLabel(action.selectors.role?.name ?? action.selectors.text ?? "");
}

// ─── Parameter detection (value heuristics) ─────────────────────────────────────

export interface FieldContext {
  /** The label or aria-label of the field */
  label?: string;
  /** The placeholder text */
  placeholder?: string;
  /** The field's name attribute */
  name?: string;
  /** The role of the element */
  role?: string;
  /** Nearby heading or section text */
  sectionContext?: string;
}

/**
 * Analyze a value entered by the user and detect if it looks like
 * account-specific data that should be parameterized.
 */
export function detectParameters(value: string, fieldContext: FieldContext): ParameterHint[] {
  const hints: ParameterHint[] = [];
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 2) return hints;

  // Phone number patterns
  if (/^\+?\d[\d\s\-().]{6,}$/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferPhoneParamName(fieldContext),
      reason: "looks_like_phone_number"
    });
  }

  // Email patterns
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferEmailParamName(fieldContext),
      reason: "looks_like_email"
    });
  }

  // Postal/zip code patterns (4-6 digits, or US format with dash)
  if (/^\d{4,6}$/.test(trimmed) || /^\d{5}-\d{4}$/.test(trimmed)) {
    if (isPostalCodeField(fieldContext)) {
      hints.push({
        originalValue: trimmed,
        suggestedName: "address.postalCode",
        reason: "looks_like_postal_code"
      });
    }
  }

  // Address-like values (multi-word, in address-labeled fields)
  if (isAddressField(fieldContext) && trimmed.includes(" ") && /\d/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferAddressParamName(fieldContext),
      reason: "looks_like_address"
    });
  }

  // Name-like values in name fields
  if (isNameField(fieldContext) && /^[A-Z][a-z]+ [A-Z]/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferNameParamName(fieldContext),
      reason: "looks_like_name"
    });
  }

  // Country selections (by field label OR by matching known country names)
  if (isCountryField(fieldContext) || isKnownCountry(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: "address.country",
      reason: "looks_like_country"
    });
    return hints; // Don't also match as state/city
  }

  // State/Province selections (by field label OR by matching patterns)
  if (isStateField(fieldContext) || isKnownStatePattern(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: "address.state",
      reason: "looks_like_address"
    });
    return hints;
  }

  // City selections (by field label: "Area Code", "City", or city-like context)
  if (isCityField(fieldContext)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: "address.city",
      reason: "looks_like_address"
    });
  }

  // Business address selections (contains street number + street name pattern)
  if (isBusinessAddressSelection(trimmed, fieldContext)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: "businessAddress",
      reason: "looks_like_address"
    });
  }

  return hints;
}

function isPostalCodeField(ctx: FieldContext): boolean {
  return /zip|postal|postcode/i.test(fieldText(ctx));
}

function isAddressField(ctx: FieldContext): boolean {
  return /address|street|line\s*[12]|suite|unit|apt/i.test(fieldText(ctx));
}

function isNameField(ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  return /name|customer|contact/i.test(text) && !/email|phone|number/i.test(text);
}

function isCountryField(ctx: FieldContext): boolean {
  return /country|region/i.test(fieldText(ctx));
}

function isStateField(ctx: FieldContext): boolean {
  return /state|province|territory/i.test(fieldText(ctx));
}

function isCityField(ctx: FieldContext): boolean {
  return /city|area code|suburb|locality/i.test(fieldText(ctx));
}

function isKnownCountry(value: string): boolean {
  const countries = [
    "australia", "singapore", "united states", "united kingdom",
    "canada", "new zealand", "japan", "germany", "france", "india",
    "brazil", "mexico", "south korea", "hong kong", "taiwan",
    "indonesia", "malaysia", "thailand", "philippines", "vietnam"
  ];
  return countries.includes(value.toLowerCase());
}

function isKnownStatePattern(value: string): boolean {
  if (/^[A-Z][a-z].*\([A-Z]{2,4}\)$/.test(value)) return true;
  const states = [
    "new south wales", "victoria", "queensland", "western australia",
    "south australia", "tasmania", "california", "new york", "texas"
  ];
  return states.some((s) => value.toLowerCase().includes(s));
}

function isBusinessAddressSelection(value: string, ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  if (/emergency|address|location/i.test(text)) {
    if (/^\d+\s+[A-Z]/.test(value) || /^[A-Z].*\d/.test(value)) return true;
    if (/\b(st|street|rd|road|ave|avenue|blvd|level|suite|floor)\b/i.test(value)) return true;
  }
  return false;
}

function inferPhoneParamName(ctx: FieldContext): string {
  return /contact/i.test(fieldText(ctx)) ? "contact.number" : "phoneNumber";
}

function inferEmailParamName(ctx: FieldContext): string {
  return /contact/i.test(fieldText(ctx)) ? "contact.email" : "contactEmail";
}

function inferAddressParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/line\s*2|suite|unit|apt|floor/i.test(text)) return "address.line2";
  if (/city/i.test(text)) return "address.city";
  if (/state|province|territory/i.test(text)) return "address.state";
  return "address.line1";
}

function inferNameParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/customer/i.test(text)) return "customerName";
  if (/contact/i.test(text)) return "contact.name";
  return "customerName";
}

function fieldText(ctx: FieldContext): string {
  return [ctx.label, ctx.placeholder, ctx.name, ctx.sectionContext].filter(Boolean).join(" ");
}
