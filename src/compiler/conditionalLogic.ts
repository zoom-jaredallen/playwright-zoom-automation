/**
 * Conditional Logic Generator — adds if/else guards to recorded workflow
 * actions based on element visibility and page state.
 *
 * Supports:
 * - Optional fields (fill only if visible)
 * - Skip-if-exists (skip workflow if target state already present)
 * - Conditional branches (if element A visible → do X, else → do Y)
 */
import type { RecordedAction, RecordedWorkflow } from "./types.js";

export interface ConditionalRule {
  /** The action this condition applies to */
  actionId: string;
  /** Type of condition */
  type: "optional" | "skip_if_exists" | "branch";
  /** For optional: the action is skipped if the element isn't visible */
  /** For skip_if_exists: the entire workflow returns "skipped" if this text/element is found */
  checkSelector?: Record<string, any>;
  checkText?: string;
  /** For branch: alternative action to take if condition is false */
  elseAction?: Partial<RecordedAction>;
}

/**
 * Analyze a recorded workflow and auto-detect conditional patterns.
 */
export function detectConditionalPatterns(workflow: RecordedWorkflow): ConditionalRule[] {
  const rules: ConditionalRule[] = [];

  for (const action of workflow.actions) {
    // Pattern 1: Optional fields — fields that may not render for all countries/types
    if (action.type === "fill" && isLikelyOptionalField(action)) {
      rules.push({
        actionId: action.id,
        type: "optional",
        checkSelector: action.selectors
      });
    }

    // Pattern 2: Skip-if-exists — if the first action after navigation checks for existing data
    if (action.type === "navigate") {
      const nextActions = getActionsAfter(workflow.actions, action.id, 3);
      const skipCheck = nextActions.find((a) =>
        a.type === "click" && /add|create|new/i.test(a.selectors.role?.name ?? a.selectors.text ?? "")
      );
      // If there's an "Add" button click right after navigation, the workflow
      // should skip if the target data already exists on the page
      if (skipCheck) {
        rules.push({
          actionId: skipCheck.id,
          type: "skip_if_exists"
        });
      }
    }
  }

  return rules;
}

/**
 * Generate TypeScript code for a conditional action.
 */
export function generateConditionalCode(action: RecordedAction, rule: ConditionalRule, indent: string): string {
  switch (rule.type) {
    case "optional":
      return `${indent}// Optional: only fill if field is visible
${indent}if (await this.isElementVisible(page, ${JSON.stringify(action.selectors)})) {
${indent}  await this.fillField(page, ${JSON.stringify(action.selectors)}, ${JSON.stringify(action.value ?? "")}, ${10_000});
${indent}}`;

    case "skip_if_exists":
      return `${indent}// Skip-if-exists: check if target state is already present
${indent}const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
${indent}if (this.targetAlreadyExists(pageText)) {
${indent}  this.options.logger.info("Target state already exists, skipping workflow");
${indent}  return { status: "skipped", message: "Target state already present" };
${indent}}`;

    case "branch":
      return `${indent}// Conditional branch
${indent}if (await this.isElementVisible(page, ${JSON.stringify(rule.checkSelector ?? action.selectors)})) {
${indent}  // Primary path
${indent}  await this.clickElement(page, ${JSON.stringify(action.selectors)}, ${10_000});
${indent}} else {
${indent}  // Alternative path
${indent}  this.options.logger.info("Primary element not found, taking alternative path");
${indent}}`;

    default:
      return "";
  }
}

/**
 * Generate the helper methods needed for conditional logic.
 */
export function generateConditionalHelpers(): string {
  return `
  private async isElementVisible(page: Page, selectors: Record<string, any>): Promise<boolean> {
    try {
      const el = await this.findElement(page, selectors, 2000);
      return await el.isVisible();
    } catch {
      return false;
    }
  }

  private targetAlreadyExists(pageText: string): boolean {
    // Override this in subclasses for workflow-specific detection
    const config = this.options.config.address;
    const tokens = [config.line1, config.city, config.postalCode].filter(Boolean);
    return tokens.every(token => pageText.toLowerCase().includes(token!.toLowerCase()));
  }
`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isLikelyOptionalField(action: RecordedAction): boolean {
  const label = action.selectors.label ?? action.selectors.role?.name ?? "";
  // Fields that are commonly optional across different country/number-type combos
  return /contact number|line 2|suite|unit|apt|state|province/i.test(label);
}

function getActionsAfter(actions: RecordedAction[], afterId: string, count: number): RecordedAction[] {
  const index = actions.findIndex((a) => a.id === afterId);
  if (index < 0) return [];
  return actions.slice(index + 1, index + 1 + count);
}
