// ─── Recorded Action Types ───────────────────────────────────────────────────

export type ActionType = "click" | "fill" | "select" | "navigate" | "upload" | "wait" | "assert" | "screenshot" | "dismiss";

export interface SelectorStrategy {
  /** ARIA role + accessible name (most stable) */
  role?: { role: string; name?: string };
  /** Label text association */
  label?: string;
  /** Visible text content */
  text?: string;
  /** data-testid attribute */
  testId?: string;
  /** CSS selector (fallback) */
  css?: string;
}

export interface ParameterHint {
  originalValue: string;
  suggestedName: string;
  reason:
    | "looks_like_phone_number"
    | "looks_like_email"
    | "looks_like_name"
    | "looks_like_address"
    | "looks_like_postal_code"
    | "looks_like_country"
    | "matches_account_field"
    | "user_marked";
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
  /** Human-readable description auto-generated from the action */
  description?: string;
}

// ─── Workflow Schema ─────────────────────────────────────────────────────────

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

// ─── Extension Messages ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "PAUSE_RECORDING" }
  | { type: "RESUME_RECORDING" }
  | { type: "GET_STATUS" }
  | { type: "ACTION_RECORDED"; action: RecordedAction }
  | { type: "STATUS_RESPONSE"; recording: boolean; paused: boolean; actionCount: number }
  | { type: "RECORDER_STATE_UPDATED"; recording: boolean; paused: boolean; actions: RecordedAction[] }
  | { type: "RECORDING_STARTED" }
  | { type: "RECORDING_STOPPED"; workflow: RecordedWorkflow }
  | { type: "UPDATE_PARAMETER"; actionId: string; paramIndex: number; confirmed: boolean }
  | { type: "UPDATE_ACTION"; actionId: string; description?: string; cssSelector?: string; selectorNote?: string }
  | { type: "MOVE_ACTION"; actionId: string; direction: "up" | "down" }
  | { type: "DELETE_ACTION"; actionId: string }
  | { type: "ADD_NAVIGATION_ACTION"; url: string }
  | { type: "ADD_ASSERTION_ACTION"; assertionType: RecordedAction["assertionType"]; expected: string; timeout?: number; onFailure?: RecordedAction["onFailure"] }
  | { type: "ADD_SCREENSHOT_ACTION"; label?: string }
  | { type: "ADD_WAIT_ACTION"; waitMs: number }
  | { type: "CLEAR_ACTIONS" }
  | { type: "GET_ACTIONS" }
  | { type: "BUILD_WORKFLOW" }
  | { type: "ACTIONS_RESPONSE"; actions: RecordedAction[] };
