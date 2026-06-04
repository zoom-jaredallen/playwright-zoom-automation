/**
 * Canonical recorded-workflow schema, shared by the Chrome extension, the
 * compiler, the server, and the Web UI. This is the single source of truth;
 * other surfaces re-export these types.
 */

export type ActionType =
  | "click"
  | "fill"
  | "select"
  | "navigate"
  | "upload"
  | "wait"
  | "assert"
  | "screenshot"
  | "dismiss"
  | "hover"
  | "press"
  | "download"
  | "dialog";

export interface SelectorStrategy {
  role?: { role: string; name?: string };
  label?: string;
  text?: string;
  testId?: string;
  css?: string;
  /** 0-based index disambiguating which match to use when several match. */
  nth?: number;
}

export type AssertionType =
  | "textVisible"
  | "elementVisible"
  | "urlContains"
  | "fieldValue"
  | "tableRowContains"
  | "hasText"
  | "hasValue";

export type OnFailure = "fail" | "retry" | "skip" | "screenshot";

export interface ParameterHint {
  originalValue: string;
  suggestedName: string;
  reason: string;
  confirmed?: boolean;
}

export interface StepCondition {
  type: "none" | "textExistsSkip" | "elementVisibleClick" | "fieldEmptyFill" | "addressAlreadyExistsSkipAccount";
  text?: string;
  selector?: SelectorStrategy;
}

export interface RecordedAction {
  id: string;
  timestamp: number;
  type: ActionType;
  selectors: SelectorStrategy;
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
}

export interface WorkflowParameter {
  name: string;
  type: "string" | "number" | "file" | "select";
  required: boolean;
  description: string;
  defaultValue?: string;
  options?: string[];
  source: "addressProfile" | "config" | "env" | "account" | "prompt";
}

export interface WorkflowAssertion {
  afterAction: string;
  type: "urlContains" | "textVisible" | "elementVisible" | "responseOk" | "fieldValue";
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
}
