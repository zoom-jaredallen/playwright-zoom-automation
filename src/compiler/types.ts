/**
 * Server-side mirror of the extension's RecordedWorkflow schema.
 * These types define the JSON format that the extension exports and
 * the compiler consumes.
 */

export type ActionType = "click" | "fill" | "select" | "navigate" | "upload" | "wait" | "assert" | "screenshot" | "dismiss";

export interface SelectorStrategy {
  role?: { role: string; name?: string };
  label?: string;
  text?: string;
  testId?: string;
  css?: string;
}

export interface ParameterHint {
  originalValue: string;
  suggestedName: string;
  reason: string;
  confirmed?: boolean;
}

export interface RecordedAction {
  id: string;
  timestamp: number;
  type: ActionType;
  selectors: SelectorStrategy;
  value?: string;
  url?: string;
  filePath?: string;
  assertionType?: "textVisible" | "elementVisible" | "urlContains" | "fieldValue" | "tableRowContains";
  expected?: string;
  timeout?: number;
  onFailure?: "fail" | "retry" | "skip" | "screenshot";
  screenshotLabel?: string;
  waitMs?: number;
  selectorNote?: string;
  pageUrl: string;
  pageTitle: string;
  frameSelector?: string;
  parameterHints?: ParameterHint[];
  description?: string;
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
  onFailure: "fail" | "retry" | "skip" | "screenshot";
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
    category: "phone" | "settings" | "compliance" | "custom";
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
}

export interface CompileResult {
  id: string;
  outputDir: string;
  warnings: string[];
  testResults: {
    parameterCheck: "passed" | "failed";
    selectorCheck: "passed" | "failed";
    assertionCoverage: string;
  };
}
