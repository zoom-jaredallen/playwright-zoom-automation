/**
 * Workflow Compiler — converts a RecordedWorkflow JSON into a runnable
 * TypeScript WorkflowPlugin with error handling, assertions, and tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CompileResult, RecordedAction, RecordedWorkflow, SelectorStrategy } from "./types.js";
import { generateHealingCode } from "./selectorHealing.js";

export function compileWorkflow(workflow: RecordedWorkflow, outputBase: string): CompileResult {
  const id = slugify(workflow.meta.name || `recorded-${Date.now()}`);
  const outputDir = path.join(outputBase, id);
  mkdirSync(outputDir, { recursive: true });

  const warnings: string[] = [];

  // Validate
  const paramCheck = validateParameters(workflow);
  const selectorCheck = validateSelectors(workflow, warnings);
  const assertionCoverage = calculateAssertionCoverage(workflow);

  // Generate files
  writeFileSync(path.join(outputDir, "schema.json"), JSON.stringify(workflow, null, 2) + "\n", "utf8");
  writeFileSync(path.join(outputDir, "index.ts"), generatePluginFile(id, workflow), "utf8");
  writeFileSync(path.join(outputDir, "flow.ts"), generateFlowFile(id, workflow), "utf8");
  writeFileSync(path.join(outputDir, "test.ts"), generateTestFile(id, workflow), "utf8");

  return {
    id,
    outputDir,
    warnings,
    testResults: {
      parameterCheck: paramCheck ? "passed" : "failed",
      selectorCheck: selectorCheck ? "passed" : "failed",
      assertionCoverage: `${assertionCoverage}%`
    }
  };
}

// ─── Code Generation ─────────────────────────────────────────────────────────

function generatePluginFile(id: string, workflow: RecordedWorkflow): string {
  const className = pascalCase(id) + "Flow";
  return `import { ${className} } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "${id}",
  name: ${JSON.stringify(workflow.meta.name)},
  description: ${JSON.stringify(workflow.meta.description)},
  enabled: true,
  category: "${workflow.meta.category}",
  createFlow(context) {
    return new ${className}(context);
  }
};

export default plugin;
`;
}

function generateFlowFile(id: string, workflow: RecordedWorkflow): string {
  const className = pascalCase(id) + "Flow";
  const actionCode = workflow.actions.map((action, index) => generateActionCode(action, index, workflow)).join("\n\n");
  const assertionImports = workflow.assertions.length > 0 ? "\n    // Assertions are checked inline after their triggering actions" : "";

  return `import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../../automation/types.js";
import type { AppConfig } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import type { StorageState } from "../../../zoom/auth.js";
import { impersonateSubAccount } from "../../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../../zoom/businessAddressFlow.js";

export interface ${className}Options {
  browser: Browser;
  masterStorageState: StorageState;
  config: AppConfig;
  logger: Logger;
}

export class ${className} implements AutomationFlow {
  readonly name = "${id}";

  constructor(private readonly options: ${className}Options) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const context = await this.options.browser.newContext({
      storageState: this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      \`\${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-${id}-\${Date.now()}\`
    );

    try {
      await mkdir(this.options.config.runtime.artifactsDir, { recursive: true });
      await context.tracing.start({ screenshots: true, snapshots: true });

      // Impersonate sub-account
      await impersonateSubAccount({
        context,
        page,
        account: input.account,
        config: this.options.config.zoom,
        logger: this.options.logger
      });

      await dismissBlockingZoomPopups(page, this.options.logger);
${assertionImports}

      // ─── Recorded Actions ────────────────────────────────────────────
${actionCode}

      await context.tracing.stop();
      return { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: \`\${artifactBase}-failure.png\`, fullPage: true }).catch(() => undefined);
      await context.tracing.stop({ path: \`\${artifactBase}-trace.zip\` }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private resolve(paramName: string): string {
    const config = this.options.config;
    const addressMap: Record<string, string | undefined> = {
      "address.line1": config.address.line1,
      "address.line2": config.address.line2,
      "address.city": config.address.city,
      "address.state": config.address.state,
      "address.postalCode": config.address.postalCode,
      "address.country": config.address.country,
      "customerName": config.address.customerName,
      "contact.name": config.address.contactName,
      "contact.number": config.address.contactNumber,
      "contact.email": config.address.contactEmail,
      "contactEmail": config.address.contactEmail
    };
    const value = addressMap[paramName];
    if (!value) {
      throw new Error(\`Parameter "\${paramName}" could not be resolved from config\`);
    }
    return value;
  }

  private resolveValue(template: string): string {
    return template.replace(/\\{\\{([^}]+)\\}\\}/g, (_, paramName) => this.resolve(paramName.trim()));
  }

${generateHealingCode()}

  private async executeRecordedStep(
    page: Page,
    artifactBase: string,
    description: string,
    policy: { retryCount?: number; retryDelayMs?: number; continueOnFailure?: boolean; screenshotOnFailure?: boolean },
    step: () => Promise<void>
  ): Promise<void> {
    const attempts = Math.max(1, (policy.retryCount ?? 0) + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await step();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          this.options.logger.warn("Recorded step failed; retrying", { description, attempt, attempts, error: error instanceof Error ? error.message : String(error) });
          await page.waitForTimeout(policy.retryDelayMs ?? 1_000);
        }
      }
    }
    if (policy.screenshotOnFailure) {
      await page.screenshot({ path: \`\${artifactBase}-\${description.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-failure.png\`, fullPage: true }).catch(() => undefined);
    }
    if (policy.continueOnFailure) {
      this.options.logger.warn("Continuing after recorded step failure", { description, error: lastError instanceof Error ? lastError.message : String(lastError) });
      return;
    }
    throw lastError;
  }

  private async shouldSkipRecordedStep(page: Page, condition: Record<string, any> | undefined, actionSelectors: Record<string, any>): Promise<"step" | "account" | undefined> {
    if (!condition || condition.type === "none") return undefined;
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const conditionText = condition.text as string | undefined;
    if ((condition.type === "textExistsSkip" || condition.type === "addressAlreadyExistsSkipAccount") && conditionText && bodyText.toLowerCase().includes(conditionText.toLowerCase())) {
      return condition.type === "addressAlreadyExistsSkipAccount" ? "account" : "step";
    }
    if (condition.type === "addressAlreadyExistsSkipAccount" && this.targetAlreadyExists(bodyText)) {
      return "account";
    }
    if (condition.type === "elementVisibleClick") {
      return await this.isElementVisible(page, condition.selector ?? actionSelectors) ? undefined : "step";
    }
    if (condition.type === "fieldEmptyFill") {
      const element = await this.findElement(page, condition.selector ?? actionSelectors, 2_000).catch(() => undefined);
      if (!element) return "step";
      const value = await element.inputValue({ timeout: 500 }).catch(() => "");
      return value.trim() ? "step" : undefined;
    }
    return undefined;
  }

  private async isElementVisible(page: Page, selectors: Record<string, any>): Promise<boolean> {
    try {
      const element = await this.findElement(page, selectors, 2_000);
      return await element.isVisible();
    } catch {
      return false;
    }
  }

  private targetAlreadyExists(pageText: string): boolean {
    const config = this.options.config.address;
    const tokens = [config.line1, config.city, config.postalCode].filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => pageText.toLowerCase().includes(token!.toLowerCase()));
  }
}
`;
}

function generateActionCode(action: RecordedAction, index: number, workflow: RecordedWorkflow): string {
  const indent = "      ";
  const stepComment = `${indent}// Step ${index + 1}: ${action.description ?? action.type}`;
  const timeout = action.timeout ?? workflow.config.defaultTimeout;
  const coreIndent = "        ";
  let core: string;

  switch (action.type) {
    case "navigate":
      core = `${coreIndent}await page.goto(\`\${this.options.config.zoom.webBaseUrl.replace(/\\/$/, "")}${action.url ? new URL(action.url).pathname + new URL(action.url).hash : "/"}\`, { waitUntil: "domcontentloaded", timeout: ${timeout} });
${coreIndent}await page.waitForLoadState("networkidle", { timeout: ${timeout} }).catch(() => undefined);
${coreIndent}await dismissBlockingZoomPopups(page, this.options.logger);`;
      break;

    case "click":
      core = `${coreIndent}await this.clickElement(page, ${JSON.stringify(action.selectors)}, ${timeout});`;
      break;

    case "fill": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)})`
        : JSON.stringify(action.value ?? "");
      core = `${coreIndent}await this.fillField(page, ${JSON.stringify(action.selectors)}, ${value}, ${timeout});`;
      break;
    }

    case "select": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)})`
        : JSON.stringify(action.value ?? "");
      core = `${coreIndent}await this.selectOption(page, ${JSON.stringify(action.selectors)}, ${value}, ${timeout});`;
      break;
    }

    case "upload":
      core = `${coreIndent}// File upload — path resolved from config.documents
${coreIndent}await this.uploadFile(page, ${JSON.stringify(action.selectors)}, ${timeout});`;
      break;

    case "wait":
      core = `${coreIndent}await page.waitForTimeout(${Math.min(Math.max(action.waitMs ?? timeout, 250), 60_000)});`;
      break;

    case "assert":
      return wrapGeneratedAction(action, stepComment, generateAssertionActionCode(action, coreIndent, timeout), workflow);

    case "screenshot": {
      const label = slugify(action.screenshotLabel ?? action.description ?? `step-${index + 1}`);
      core = `${coreIndent}await page.screenshot({ path: \`\${artifactBase}-${label}.png\`, fullPage: true });`;
      break;
    }

    case "dismiss":
      core = `${coreIndent}await dismissBlockingZoomPopups(page, this.options.logger);`;
      break;

    default:
      core = `${coreIndent}// TODO: Implement ${action.type} action`;
      break;
  }

  return wrapGeneratedAction(action, stepComment, core, workflow);
}

function wrapGeneratedAction(action: RecordedAction, stepComment: string, core: string, workflow: RecordedWorkflow): string {
  const indent = "      ";
  const condition = JSON.stringify(action.condition);
  const selectors = JSON.stringify(action.selectors);
  const policy = JSON.stringify({
    retryCount: action.retryCount ?? 0,
    retryDelayMs: action.retryDelayMs ?? workflow.config.defaultTimeout / 10,
    continueOnFailure: action.continueOnFailure ?? action.onFailure === "skip",
    screenshotOnFailure: action.screenshotOnFailure ?? action.onFailure === "screenshot"
  });
  const description = JSON.stringify(action.description ?? action.type);

  return `${stepComment}
${indent}{
${indent}  const skip = await this.shouldSkipRecordedStep(page, ${condition}, ${selectors});
${indent}  if (skip === "account") {
${indent}    this.options.logger.info("Recorded workflow skip condition matched", { step: ${description} });
${indent}    return { status: "skipped", message: "Skip condition matched" };
${indent}  }
${indent}  if (skip !== "step") {
${indent}    await this.executeRecordedStep(page, artifactBase, ${description}, ${policy}, async () => {
${core}
${indent}    });
${indent}  }
${indent}}`;
}

function generateAssertionActionCode(action: RecordedAction, indent: string, timeout: number): string {
  const expected = JSON.stringify(action.expected ?? action.value ?? "");
  const actionTimeout = action.timeout ?? timeout;
  const onFailure = action.onFailure ?? "screenshot";
  const assertionBody = (() => {
    switch (action.assertionType) {
      case "urlContains":
        return `${indent}if (!page.url().includes(${expected})) throw new Error("Expected URL to contain " + ${expected});`;
      case "elementVisible":
        return `${indent}await page.locator(${expected}).first().waitFor({ state: "visible", timeout: ${actionTimeout} });`;
      case "fieldValue":
        return `${indent}const expectedValue = ${expected};
${indent}const fields = page.locator("input, textarea");
${indent}const fieldCount = await fields.count();
${indent}let fieldMatched = false;
${indent}for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
${indent}  const fieldValue = await fields.nth(fieldIndex).inputValue({ timeout: 1_000 }).catch(() => "");
${indent}  if (fieldValue.includes(expectedValue)) {
${indent}    fieldMatched = true;
${indent}    break;
${indent}  }
${indent}}
${indent}if (!fieldMatched) throw new Error("Expected a field value to contain " + expectedValue);`;
      case "tableRowContains":
        return `${indent}await page.locator("tr", { hasText: ${expected} }).first().waitFor({ state: "visible", timeout: ${actionTimeout} });`;
      case "textVisible":
      default:
        return `${indent}await page.getByText(${expected}, { exact: false }).first().waitFor({ state: "visible", timeout: ${actionTimeout} });`;
    }
  })();

  if (onFailure === "skip") {
    return `${indent}try {
${assertionBody}
${indent}} catch (error) {
${indent}  this.options.logger.warn("Recorded assertion skipped after failure", { step: ${JSON.stringify(action.description ?? action.id)}, error: error instanceof Error ? error.message : String(error) });
${indent}}`;
  }

  if (onFailure !== "screenshot") {
    return assertionBody;
  }

  const label = slugify(action.description ?? action.id);
  return `${indent}try {
${assertionBody}
${indent}} catch (error) {
${indent}  await page.screenshot({ path: \`\${artifactBase}-${label}-assertion-failure.png\`, fullPage: true }).catch(() => undefined);
${indent}  throw error;
${indent}}`;
}

function generateTestFile(id: string, workflow: RecordedWorkflow): string {
  const className = pascalCase(id) + "Flow";
  return `import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("${className}", () => {
  it("exports a valid workflow plugin", () => {
    expect(plugin.id).toBe("${id}");
    expect(plugin.name).toBeTruthy();
    expect(plugin.enabled).toBe(true);
    expect(plugin.createFlow).toBeTypeOf("function");
  });

  it("has ${workflow.parameters.length} parameter(s) defined in schema", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.parameters).toHaveLength(${workflow.parameters.length});
${workflow.parameters.map((p) => `    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "${p.name}", required: ${p.required} }));`).join("\n")}
  });

  it("has ${workflow.assertions.length} assertion(s) for verification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.assertions).toHaveLength(${workflow.assertions.length});
  });

  it("has ${workflow.actions.length} recorded action(s)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.actions).toHaveLength(${workflow.actions.length});
  });
});
`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateParameters(workflow: RecordedWorkflow): boolean {
  return workflow.parameters.every((p) => p.name && p.source);
}

function validateSelectors(workflow: RecordedWorkflow, warnings: string[]): boolean {
  let allValid = true;
  for (const action of workflow.actions) {
    if (["navigate", "wait", "assert", "screenshot", "dismiss"].includes(action.type)) continue;
    const s = action.selectors;
    const hasStable = Boolean(s.role || s.label || s.text || s.testId);
    if (!hasStable && s.css) {
      warnings.push(`Action "${action.description ?? action.id}": only CSS selector available — may be unstable`);
      allValid = false;
    }
  }
  return allValid;
}

function calculateAssertionCoverage(workflow: RecordedWorkflow): number {
  const submitActions = workflow.actions.filter((a) => {
    if (a.type !== "click") return false;
    const name = a.selectors.role?.name ?? a.selectors.text ?? "";
    return /save|submit|add|continue|confirm/i.test(name);
  });
  if (submitActions.length === 0) return 100;
  const covered = submitActions.filter((a) =>
    workflow.assertions.some((assertion) => assertion.afterAction === a.id)
  );
  return Math.round((covered.length / submitActions.length) * 100);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function pascalCase(slug: string): string {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}
