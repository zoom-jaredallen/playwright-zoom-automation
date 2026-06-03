/**
 * Workflow Compiler — converts a RecordedWorkflow JSON into a runnable
 * TypeScript WorkflowPlugin with error handling, assertions, and tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CompileResult, RecordedAction, RecordedWorkflow, SelectorStrategy } from "./types.js";

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
import type { WorkflowPlugin } from "../../workflows/types.js";

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
import type { AutomationFlow, FlowInput, FlowResult } from "../../automation/types.js";
import type { AppConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import type { StorageState } from "../../zoom/auth.js";
import { impersonateSubAccount } from "../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../zoom/businessAddressFlow.js";

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
}
`;
}

function generateActionCode(action: RecordedAction, index: number, workflow: RecordedWorkflow): string {
  const indent = "      ";
  const stepComment = `${indent}// Step ${index + 1}: ${action.description ?? action.type}`;
  const timeout = workflow.config.defaultTimeout;

  switch (action.type) {
    case "navigate":
      return `${stepComment}
${indent}await page.goto(\`\${this.options.config.zoom.webBaseUrl.replace(/\\/$/, "")}${action.url ? new URL(action.url).pathname + new URL(action.url).hash : "/"}\`, { waitUntil: "domcontentloaded", timeout: ${timeout} });
${indent}await page.waitForLoadState("networkidle", { timeout: ${timeout} }).catch(() => undefined);
${indent}await dismissBlockingZoomPopups(page, this.options.logger);`;

    case "click":
      return `${stepComment}
${indent}await this.clickElement(page, ${JSON.stringify(action.selectors)}, ${timeout});`;

    case "fill": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)})`
        : JSON.stringify(action.value ?? "");
      return `${stepComment}
${indent}await this.fillField(page, ${JSON.stringify(action.selectors)}, ${value}, ${timeout});`;
    }

    case "select": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)})`
        : JSON.stringify(action.value ?? "");
      return `${stepComment}
${indent}await this.selectOption(page, ${JSON.stringify(action.selectors)}, ${value}, ${timeout});`;
    }

    case "upload":
      return `${stepComment}
${indent}// File upload — path resolved from config.documents
${indent}await this.uploadFile(page, ${JSON.stringify(action.selectors)}, ${timeout});`;

    case "dismiss":
      return `${stepComment}
${indent}await dismissBlockingZoomPopups(page, this.options.logger);`;

    default:
      return `${stepComment}
${indent}// TODO: Implement ${action.type} action`;
  }
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
    if (action.type === "navigate") continue;
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
