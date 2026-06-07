import { isCommitClickLabel, scoreSelector } from "@zoom-automation/workflow-core";
import type { RecordedAction } from "@zoom-automation/workflow-core";

export type InlineFieldGroup =
  | "policy"
  | "test"
  | "selector"
  | "validationSuggestion"
  | "value"
  | "key"
  | "screenshot"
  | "wait"
  | "url"
  | "assertion";

export type StepBadgeKind = "timeout" | "retry" | "condition" | "screenshot" | "continue";

export interface StepBadge {
  kind: StepBadgeKind;
  label: string;
  title: string;
}

export interface BulkPolicyTarget {
  label: string;
  actionIds: string[];
}

export interface BulkPolicyTargets {
  allSteps: BulkPolicyTarget;
  mutatingSteps: BulkPolicyTarget;
  weakSelectorSteps: BulkPolicyTarget;
}

export interface BulkPolicyFormInput {
  timeout: string;
  retryCount: string;
  retryDelayMs: string;
  enableContinueOnFailure: boolean;
  enableScreenshotOnFailure: boolean;
}

export type BulkPolicyUpdate = Pick<
  RecordedAction,
  "timeout" | "retryCount" | "retryDelayMs" | "continueOnFailure" | "screenshotOnFailure"
>;

export function describeStep(action: RecordedAction): string {
  if (action.description) return action.description;
  if (action.type === "navigate") return `Navigate to ${action.url ?? action.pageUrl}`;
  if (action.type === "fill") return `Fill ${action.selectors.label ?? "field"}`;
  if (action.type === "click") return `Click ${action.selectors.role?.name ?? action.selectors.text ?? "element"}`;
  if (action.type === "select") return `Select ${action.value ?? "option"}`;
  if (action.type === "press") return `Press ${action.key ?? "Enter"}`;
  if (action.type === "dismiss") return "Dismiss blocking popup";
  if (action.type === "screenshot") return `Take screenshot${action.screenshotLabel ? `: ${action.screenshotLabel}` : ""}`;
  if (action.type === "wait") return `Wait ${action.waitMs ?? 1_000}ms`;
  if (action.type === "upload") return "Upload file";
  return action.type;
}

export function visibleFieldGroups(action: RecordedAction): InlineFieldGroup[] {
  const groups: InlineFieldGroup[] = ["policy", "test"];

  if (isSelectorBasedStep(action)) groups.push("selector");
  if (isSubmitLikeClickStep(action)) groups.push("validationSuggestion");
  if (action.type === "fill" || action.type === "select") groups.push("value");
  if (action.type === "press") groups.push("key");
  if (action.type === "screenshot") groups.push("screenshot");
  if (action.type === "wait") groups.push("wait");
  if (action.type === "navigate") groups.push("url");
  if (action.type === "assert") groups.push("assertion");

  return groups;
}

export function stepPolicyBadges(action: RecordedAction): StepBadge[] {
  const badges: StepBadge[] = [];
  if (action.timeout) {
    badges.push({ kind: "timeout", label: formatSeconds(action.timeout), title: `Timeout ${action.timeout}ms` });
  }
  if (action.retryCount && action.retryCount > 0) {
    badges.push({
      kind: "retry",
      label: `${action.retryCount} ${action.retryCount === 1 ? "retry" : "retries"}`,
      title: `Retry ${action.retryCount} time${action.retryCount === 1 ? "" : "s"}`
    });
  }
  if (action.condition && action.condition.type !== "none") {
    const suffix = action.condition.text ? `: ${action.condition.text}` : "";
    badges.push({ kind: "condition", label: "Condition", title: `${action.condition.type}${suffix}` });
  }
  if (action.screenshotOnFailure) {
    badges.push({ kind: "screenshot", label: "Screenshot", title: "Take screenshot on failure" });
  }
  if (action.continueOnFailure) {
    badges.push({ kind: "continue", label: "Continue", title: "Continue workflow if this step fails" });
  }
  return badges;
}

export function bulkPolicyTargets(actions: RecordedAction[]): BulkPolicyTargets {
  return {
    allSteps: {
      label: "All steps",
      actionIds: actions.map((action) => action.id)
    },
    mutatingSteps: {
      label: "Mutating steps",
      actionIds: actions.filter(isMutatingStep).map((action) => action.id)
    },
    weakSelectorSteps: {
      label: "Weak-selector steps",
      actionIds: actions
        .filter((action) => isSelectorBasedStep(action) && hasSelectorSignal(action) && scoreSelector(action.selectors).level === "low")
        .map((action) => action.id)
    }
  };
}

export function buildBulkPolicyUpdate(input: BulkPolicyFormInput): Partial<BulkPolicyUpdate> {
  const update: Partial<BulkPolicyUpdate> = {};
  if (input.timeout.trim()) update.timeout = Number(input.timeout) || 10_000;
  if (input.retryCount.trim()) update.retryCount = Number(input.retryCount) || 0;
  if (input.retryDelayMs.trim()) update.retryDelayMs = Number(input.retryDelayMs) || 1_000;
  if (input.enableContinueOnFailure) update.continueOnFailure = true;
  if (input.enableScreenshotOnFailure) update.screenshotOnFailure = true;
  return update;
}

export function isSelectorBasedStep(action: RecordedAction): boolean {
  return !["navigate", "wait", "screenshot", "dismiss", "dialog", "if"].includes(action.type);
}

export function isSubmitLikeClickStep(action: RecordedAction): boolean {
  if (action.type !== "click") return false;
  const label = action.selectors.role?.name ?? action.selectors.text ?? action.selectors.label ?? action.description ?? "";
  return isCommitClickLabel(label);
}

function isMutatingStep(action: RecordedAction): boolean {
  return ["click", "fill", "select", "press", "upload", "dialog"].includes(action.type);
}

function hasSelectorSignal(action: RecordedAction): boolean {
  return Boolean(
    action.selectors.role
      || action.selectors.label
      || action.selectors.text
      || action.selectors.testId
      || action.selectors.css
      || action.selectors.xpath
  );
}

function formatSeconds(milliseconds: number): string {
  return milliseconds % 1_000 === 0 ? `${milliseconds / 1_000}s` : `${milliseconds}ms`;
}
