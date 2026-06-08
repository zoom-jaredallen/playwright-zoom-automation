/**
 * Canonical recorded-workflow schema, shared by the Chrome extension, the
 * compiler, the server, and the Web UI. This is the single source of truth;
 * other surfaces re-export these types.
 */

export type ActionType =
  | "click"
  | "fill"
  | "select"
  | "selectRows"
  | "navigate"
  | "upload"
  | "wait"
  | "assert"
  | "screenshot"
  | "dismiss"
  | "hover"
  | "press"
  | "download"
  | "dialog"
  | "if";

/** How an anchor relates the scope to the target element. "within" is the common case. */
export type AnchorRelationship = "within" | "near" | "nearControl" | "rightOf" | "leftOf" | "above" | "below";

export interface SelectorStrategy {
  role?: {
    role: string;
    name?: string;
    /** Require an exact accessible-name match instead of substring. */
    exact?: boolean;
    /** ARIA-state constraints, compiled to getByRole(role, { checked, ... }). */
    checked?: boolean;
    expanded?: boolean;
    selected?: boolean;
    pressed?: boolean;
  };
  label?: string;
  text?: string;
  testId?: string;
  css?: string;
  xpath?: string;
  /** 0-based index disambiguating which match to use when several match. */
  nth?: number;
  /**
   * Anchor / relative match: scope the target to a container identified by anchor
   * text (e.g. the table row whose Name contains "michael.chen"), then resolve the
   * normal strategies within/near that scope.
   */
  anchor?: {
    text?: string;
    /** Container role to scope to. Defaults to "row". */
    scopeRole?: string;
    /** Optional CSS selector for non-ARIA containers such as dialogs, forms, or sections. */
    scopeSelector?: string;
    /** Human-readable anchor category used by repair UIs and diagnostics. */
    kind?: "row" | "listitem" | "dialog" | "form" | "section" | "formField" | "heading" | "custom";
    relationship?: AnchorRelationship;
  };
}

export type SelectorCandidateKind =
  | "role"
  | "label"
  | "testId"
  | "text"
  | "css"
  | "xpath"
  | "relative"
  | "zoomComponent";

export type SelectorCandidateSource = "recorded" | "legacy" | "manual" | "healed" | "generated";

export interface SelectorDiagnostics {
  matchedCount?: number;
  visibleCount?: number;
  chosenPreview?: string;
  uniquelyIdentifiesTarget?: boolean;
  anchorReducedMatches?: boolean;
  brittleReason?: string;
  context?: SelectorContextDiagnostics;
}

export interface StepCapture {
  thumbnail?: {
    dataUrl: string;
    width: number;
    height: number;
  };
  screenshotArtifactId?: string;
  capturedAt: string;
  pageUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  targetBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SelectorDiagnosticsSummary {
  matchedCount: number;
  visibleCount: number;
  chosenCandidateId?: string;
  confidence: SelectorCandidateScore;
  targetPreview?: string;
  anchor?: {
    text?: string;
    scopeRole?: string;
    scopeSelector?: string;
    kind?: "row" | "listitem" | "dialog" | "form" | "section" | "formField" | "heading" | "custom";
    relationship?: AnchorRelationship;
    resolved: boolean;
  };
  context?: SelectorContextDiagnostics;
}

export interface SelectorContextDiagnostics {
  appliedAutomatically: boolean;
  mode: "primary" | "fallback" | "diagnostic";
  reason: string;
  directMatchedCount: number;
  directVisibleCount: number;
  contextMatchedCount: number;
  contextVisibleCount: number;
}

export interface SelectorRepairSuggestion {
  candidateId: string;
  selector: SelectorStrategy;
  source: SelectorCandidateSource;
  score: SelectorCandidateScore;
  matchedCount: number;
  visibleCount: number;
  risk: "low" | "medium" | "high";
}

export interface SelectorCandidate {
  id: string;
  kind: SelectorCandidateKind;
  selector: SelectorStrategy;
  source?: SelectorCandidateSource;
  label?: string;
  diagnostics?: SelectorDiagnostics;
}

export interface SelectorCandidateScore {
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
}

export interface RankedSelectorCandidate extends SelectorCandidate {
  rank: number;
  score: SelectorCandidateScore;
}

export interface SelectMetadata {
  targetCandidates?: SelectorCandidate[];
  optionCandidates?: SelectorCandidate[];
  optionLabel?: string;
  optionValue?: string;
  popupSelectorHint?: SelectorStrategy;
  verificationText?: string;
}

export interface RowSelectionPolicy {
  mode: "firstAvailable";
  count: number;
  entityKind?: "phoneNumber" | string;
  outputName?: string;
  rowSelector?: string;
  checkboxSelector?: string;
  valuePattern?: string;
  unavailableText?: string;
  minimumCount?: number;
}

export type WorkflowIntentType =
  | "zoom.selectComboboxOption"
  | "zoom.fillFieldByLabel"
  | "zoom.clickPrimaryAction"
  | "zoom.selectTableRows"
  | "zoom.verifyEntityExists"
  | "zoom.skipIfEntityExists";

export interface WorkflowIntentMetadata {
  fieldLabel?: string;
  optionLabel?: string;
  tableEntityKind?: string;
  rowMatchText?: string;
  rowMatchPattern?: string;
  rowCount?: number;
  expectedOutcome?: string;
  mutationBoundary?: boolean;
  confidence?: "high" | "medium" | "low";
  source?: "recorded" | "hardened" | "manual";
}

/**
 * A boolean condition tree, shared by per-step guards and IF/ELSE blocks. Leaf
 * predicates are evaluated against the live page (Playwright) or DOM (preflight).
 */
export type Predicate =
  | { kind: "always" }
  | { kind: "and"; operands: Predicate[] }
  | { kind: "or"; operands: Predicate[] }
  | { kind: "not"; operand: Predicate }
  | { kind: "textVisible"; text: string }
  | { kind: "elementVisible"; selector: SelectorStrategy }
  | { kind: "fieldEmpty"; selector: SelectorStrategy }
  | { kind: "fieldValue"; selector: SelectorStrategy; equals?: string; contains?: string }
  | { kind: "urlContains"; text: string };

export type AssertionType =
  | "textVisible"
  | "elementVisible"
  | "urlContains"
  | "urlMatches"
  | "fieldValue"
  | "tableRowContains"
  | "addressStatusEquals"
  | "toastVisible"
  | "hasText"
  | "hasValue"
  | "entityExists"
  | "entityAbsent"
  | "entityState";

export type OnFailure = "fail" | "retry" | "skip" | "screenshot";

export interface ParameterHint {
  originalValue: string;
  suggestedName: string;
  reason: string;
  confirmed?: boolean;
}

export interface StepCondition {
  type: "none" | "textExistsSkip" | "elementVisibleClick" | "fieldEmptyFill" | "addressAlreadyExistsSkipAccount" | "entityStateGuard";
  text?: string;
  selector?: SelectorStrategy;
  operation?: "create" | "update" | "delete" | "assign" | "remove" | "verify" | "unknown";
  entityKind?: string;
  match?: {
    allText?: string[];
    anyText?: string[];
  };
  whenMatched?: "skipStep" | "skipAccount";
  whenMissing?: "skipStep" | "skipAccount";
}

export interface RecordedAction {
  id: string;
  timestamp: number;
  type: ActionType;
  selectors: SelectorStrategy;
  selectorCandidates?: SelectorCandidate[];
  selectedCandidateId?: string;
  selectMetadata?: SelectMetadata;
  rowSelection?: RowSelectionPolicy;
  capture?: StepCapture;
  selectorDiagnostics?: SelectorDiagnosticsSummary;
  repairSuggestions?: SelectorRepairSuggestion[];
  value?: string;
  url?: string;
  filePath?: string;
  assertionType?: AssertionType;
  expected?: string;
  timeout?: number;
  onFailure?: OnFailure;
  retryCount?: number;
  retryDelayMs?: number;
  continueOnFailure?: boolean;
  screenshotOnFailure?: boolean;
  condition?: StepCondition;
  /** Compound predicate guard. When set, the step runs only if it evaluates true. */
  guard?: Predicate;
  /** What to do when `guard` is false: skip just this step (default) or the whole account. */
  guardElse?: "skip" | "skipAccount";
  screenshotLabel?: string;
  waitMs?: number;
  selectorNote?: string;
  pageUrl: string;
  pageTitle: string;
  /** CSS selector of the iframe the target lives in; compiled to page.frameLocator(). */
  frameSelector?: string;
  parameterHints?: ParameterHint[];
  description?: string;
  /** Key for "press" actions, e.g. "Enter", "Tab", "Escape", "ArrowDown". */
  key?: string;
  /** Desired ARIA end-state for idempotent toggles; click is skipped if already satisfied. */
  ariaState?: { checked?: boolean; expanded?: boolean; selected?: boolean };
  /** Path/URL fragment of the XHR/fetch this action triggers; compiled to waitForResponse. */
  networkWaitUrl?: string;
  /** Expected URL fragment after a navigating action; compiled to waitForURL. */
  waitForUrl?: string;
  /** How to respond to a native dialog (confirm/alert/beforeunload). */
  dialogAction?: "accept" | "dismiss";
  /** Optional prompt text supplied when accepting a dialog. */
  dialogPromptText?: string;
  /** When true, a screenshot action is scoped to the matched element via locator.screenshot(). */
  elementScreenshot?: boolean;
  /** Generic risk classification used by bulk-safe replay and readiness checks. */
  sideEffectRisk?: "read" | "edit" | "mutation" | "destructive";
  /**
   * Skip this step during a dry run (used for mutating/commit steps like Save so a
   * dry run validates the flow without making changes). The compiler auto-marks
   * submit-like clicks; this overrides that per step.
   */
  skipInDryRun?: boolean;
  /** Semantic action captured or inferred from raw browser events. */
  intentType?: WorkflowIntentType;
  /** Structured data used by hardening, preflight, and generated runtime helpers. */
  intentMetadata?: WorkflowIntentMetadata;
  // ─── Control flow (type === "if") ───────────────────────────────────────────
  /** Condition for an IF block. */
  ifCondition?: Predicate;
  /** Steps run when ifCondition is true. */
  thenActions?: RecordedAction[];
  /** Steps run when ifCondition is false. */
  elseActions?: RecordedAction[];
}

export interface WorkflowParameter {
  name: string;
  type: "string" | "number" | "file" | "select";
  required: boolean;
  description: string;
  defaultValue?: string;
  options?: string[];
  source: "addressProfile" | "config" | "env" | "account" | "prompt";
  ui?: WorkflowParameterUiHint;
}

export interface WorkflowParameterUiHint {
  group?: string;
  label?: string;
  helpText?: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  fileAccept?: string;
  accountOverrideAllowed?: boolean;
}

export interface WorkflowAssertion {
  afterAction: string;
  type:
    | "urlContains"
    | "urlMatches"
    | "textVisible"
    | "elementVisible"
    | "responseOk"
    | "fieldValue"
    | "tableRowContains"
    | "addressStatusEquals"
    | "toastVisible"
    | "entityExists"
    | "entityAbsent"
    | "entityState";
  expected: string;
  timeout: number;
  onFailure: OnFailure;
}

export type WorkflowCategory = "phone" | "settings" | "compliance" | "custom";

export interface WorkflowQualityReport {
  score: number;
  selectorStability: number;
  assertionCoverage: number;
  evidenceCoverage: number;
  riskySteps: number;
  hardcodedValues: number;
  unsupportedBrowserPreflightSteps: number;
  warnings: string[];
}

export interface RecordedWorkflow {
  version: 1;
  meta: {
    name: string;
    description: string;
    recordedAt: string;
    recordedOnUrl: string;
    recordedByEmail?: string;
    durationMs: number;
    category: WorkflowCategory;
  };
  parameters: WorkflowParameter[];
  actions: RecordedAction[];
  assertions: WorkflowAssertion[];
  config: {
    startUrl: string;
    requiresImpersonation: boolean;
    defaultTimeout: number;
    retryableErrors: string[];
  };
  quality?: WorkflowQualityReport;
  hardening?: {
    bulkReady: boolean;
    addedGuardActionId?: string;
    mutationRetryDisabledActionIds: string[];
    warnings: string[];
    intent?: unknown;
    entity?: unknown;
    addedAssertion?: unknown;
  };
}
