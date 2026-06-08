/**
 * Workflow Compiler — converts a RecordedWorkflow JSON into a runnable
 * TypeScript WorkflowPlugin with error handling, assertions, and tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CompileResult, RecordedAction, RecordedWorkflow } from "./types.js";
import { generateHealingCode } from "./selectorHealing.js";
import { generateAssertionBody } from "./assertionCompiler.js";

export function compileWorkflow(workflow: RecordedWorkflow, outputBase: string, idOverride?: string): CompileResult {
  const generatedId = slugify(workflow.meta.name || "");
  const id = idOverride ?? (generatedId || `recorded-${Date.now()}`);
  const outputDir = path.join(outputBase, id);
  mkdirSync(outputDir, { recursive: true });

  const warnings: string[] = [];

  // Validate
  const paramCheck = validateParameters(workflow);
  const selectorCheck = validateSelectors(workflow, warnings);
  const assertionCoverage = calculateAssertionCoverage(workflow);

  // Generate files. Runtime code can use the full workflow object, but the
  // committed schema should not embed large screenshot data URLs.
  writeFileSync(path.join(outputDir, "schema.json"), JSON.stringify(stripInlineCaptureThumbnails(workflow), null, 2) + "\n", "utf8");
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

function stripInlineCaptureThumbnails(workflow: RecordedWorkflow): RecordedWorkflow {
  return {
    ...workflow,
    actions: workflow.actions.map(stripActionInlineCaptureThumbnail)
  };
}

function stripActionInlineCaptureThumbnail(action: RecordedAction): RecordedAction {
  const next: RecordedAction = {
    ...action,
    selectors: { ...action.selectors },
    capture: action.capture ? { ...action.capture } : undefined,
    thenActions: action.thenActions?.map(stripActionInlineCaptureThumbnail),
    elseActions: action.elseActions?.map(stripActionInlineCaptureThumbnail)
  };
  if (next.capture?.thumbnail?.dataUrl) {
    delete next.capture.thumbnail;
  }
  return next;
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

  return `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../../automation/types.js";
import type { AppConfig } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import type { StorageState } from "../../../zoom/auth.js";
import { impersonateSubAccount } from "../../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../../zoom/popups.js";
import { resolveSelector } from "../../../runtime/selectors/selectorResolver.js";

export interface ${className}Options {
  browser: Browser;
  masterStorageState: StorageState;
  getMasterStorageState?: () => StorageState;
  config: AppConfig;
  logger: Logger;
}

export class ${className} implements AutomationFlow {
  readonly name = "${id}";

  constructor(private readonly options: ${className}Options) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const activeAccountId = input.account.id;
    let dryRunSkipped = false;
    const workflowState = new Map<string, string[]>();
    const context = await this.options.browser.newContext({
      storageState: this.options.getMasterStorageState?.() ?? this.options.masterStorageState
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
      return dryRunSkipped
        ? { status: "skipped", message: "Dry run: mutating steps were not submitted" }
        : { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: \`\${artifactBase}-failure.png\`, fullPage: true }).catch(() => undefined);
      await context.tracing.stop({ path: \`\${artifactBase}-trace.zip\` }).catch(() => undefined);
      await this.writeSelectorDiagnostics(artifactBase, error).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private resolve(paramName: string, activeAccountId?: string): string {
    const config = this.options.config;
    // Per-account value (e.g. a distinct user per sub-account) takes precedence.
    const perAccount = activeAccountId ? config.accountValues?.[activeAccountId]?.[paramName] : undefined;
    if (perAccount !== undefined && perAccount !== "") {
      return perAccount;
    }
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

  private resolveValue(template: string, activeAccountId?: string): string {
    return template.replace(/\\{\\{([^}]+)\\}\\}/g, (_, paramName) => this.resolve(paramName.trim(), activeAccountId));
  }

  private resolveExpected(template: string, workflowState: Map<string, string[]>): string {
    return template.replace(/\\{\\{([^}]+)\\}\\}/g, (_, rawName) => {
      const name = String(rawName).trim();
      const values = workflowState.get(name);
      if (values) return values.join("|");
      return this.resolve(name);
    });
  }

  private async selectRows(page: Page, policy: Record<string, any>, timeout: number, workflowState: Map<string, string[]>): Promise<void> {
    if (policy.mode !== "firstAvailable") {
      throw new Error(\`Unsupported row selection mode: \${policy.mode}\`);
    }
    const count = Math.max(1, Number(policy.count ?? 1));
    const minimumCount = Math.max(1, Number(policy.minimumCount ?? count));
    const rowSelector = policy.rowSelector ?? "tr, [role='row']";
    const checkboxSelector = policy.checkboxSelector ?? "[role='checkbox'], input[type='checkbox']";
    const valuePattern = new RegExp(policy.valuePattern ?? "\\\\+\\\\d[\\\\d\\\\s().-]{5,}");
    const unavailablePattern = policy.unavailableText ? new RegExp(policy.unavailableText, "i") : undefined;
    const selectedValues: string[] = [];
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline && selectedValues.length < count) {
      const rows = page.locator(rowSelector);
      const rowCount = await rows.count().catch(() => 0);
      for (let index = 0; index < rowCount && selectedValues.length < count; index++) {
        const row = rows.nth(index);
        if (!await row.isVisible({ timeout: 250 }).catch(() => false)) continue;
        const rowText = await row.innerText({ timeout: 500 }).catch(() => "");
        if (unavailablePattern?.test(rowText)) continue;
        const value = rowText.match(valuePattern)?.[0]?.replace(/\\s+/g, " ").trim();
        if (!value || selectedValues.includes(value)) continue;
        const checkbox = row.locator(checkboxSelector).first();
        if (!await checkbox.isVisible({ timeout: 250 }).catch(() => false)) continue;
        const disabled = await checkbox.getAttribute("aria-disabled").catch(() => null)
          ?? await checkbox.getAttribute("disabled").catch(() => null);
        if (disabled === "true" || disabled === "") continue;
        const checked = await checkbox.getAttribute("aria-checked").catch(() => null);
        const inputChecked = await checkbox.evaluate((node) => node instanceof HTMLInputElement ? node.checked : false).catch(() => false);
        if (checked !== "true" && !inputChecked) {
          await checkbox.click({ timeout });
        }
        selectedValues.push(value);
      }
      if (selectedValues.length < count) await page.waitForTimeout(500);
    }

    if (selectedValues.length < minimumCount) {
      throw new Error(\`Expected at least \${minimumCount} available row(s), found \${selectedValues.length}\`);
    }
    const outputName = policy.outputName ?? "selected.rows";
    workflowState.set(outputName, selectedValues);
    this.options.logger.info("Selected dynamic rows", { outputName, selectedValues });
  }

${generateHealingCode()}

  private async executeRecordedStep(
    page: Page,
    artifactBase: string,
    description: string,
    policy: { retryCount?: number; retryDelayMs?: number; continueOnFailure?: boolean; screenshotOnFailure?: boolean; readyTimeoutMs?: number },
    step: () => Promise<void>
  ): Promise<void> {
    const attempts = Math.max(1, (policy.retryCount ?? 0) + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await step();
        await this.waitForPageReady(page, policy.readyTimeoutMs ?? 10_000);
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

  private async waitForPageReady(page: Page, timeout: number): Promise<void> {
    const shortTimeout = Math.min(Math.max(timeout, 1_000), 5_000);
    const loadingSelectors = [
      "[aria-busy='true']",
      "[role='progressbar']",
      ".loading",
      ".loader",
      ".spinner",
      ".zm-loader",
      ".zm-loading",
      ".cpzui-loading",
      ".cpzui-spinner",
      "[class*='loading']",
      "[class*='spinner']"
    ].join(",");

    await page.waitForLoadState("domcontentloaded", { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForFunction((selectors) => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      return !Array.from(document.querySelectorAll(selectors)).some((element) => {
        const text = element.textContent?.toLowerCase() ?? "";
        return visible(element) && !text.includes("loaded") && !text.includes("not loading");
      });
    }, loadingSelectors, { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForTimeout(300);
  }

  private async shouldSkipRecordedStep(page: Page, condition: Record<string, any> | undefined, actionSelectors: Record<string, any>): Promise<"step" | "account" | undefined> {
    if (!condition || condition.type === "none") return undefined;
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const conditionText = condition.text as string | undefined;
    if (condition.type === "textExistsSkip" && conditionText && bodyText.toLowerCase().includes(conditionText.toLowerCase())) {
      return "step";
    }
    if (condition.type === "addressAlreadyExistsSkipAccount" && conditionText) {
      return bodyText.toLowerCase().includes(conditionText.toLowerCase()) && this.targetAlreadyExists(bodyText)
        ? "account"
        : undefined;
    }
    if (condition.type === "addressAlreadyExistsSkipAccount" && this.targetAlreadyExists(bodyText)) {
      return "account";
    }
    if (condition.type === "entityStateGuard") {
      const matched = this.entityStateGuardMatched(bodyText, condition);
      if (matched && condition.whenMatched === "skipAccount") return "account";
      if (matched && condition.whenMatched === "skipStep") return "step";
      if (!matched && condition.whenMissing === "skipAccount") return "account";
      if (!matched && condition.whenMissing === "skipStep") return "step";
      return undefined;
    }
    if (condition.type === "elementVisibleClick") {
      return await this.isElementVisible(page, condition.selector ?? actionSelectors) ? undefined : "step";
    }
    if (condition.type === "fieldEmptyFill") {
      const element = await this.findElement(page, condition.selector ?? actionSelectors, [], 2_000).catch(() => undefined);
      if (!element) return "step";
      const value = await element.inputValue({ timeout: 500 }).catch(() => "");
      return value.trim() ? "step" : undefined;
    }
    return undefined;
  }

  private async isElementVisible(page: Page, selectors: Record<string, any>): Promise<boolean> {
    try {
      const element = await this.findElement(page, selectors, [], 2_000);
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

  private entityStateGuardMatched(pageText: string, condition: Record<string, any>): boolean {
    const lower = pageText.toLowerCase();
    const allText = Array.isArray(condition.match?.allText) ? condition.match.allText : [];
    const anyText = Array.isArray(condition.match?.anyText) ? condition.match.anyText : [];
    const allMatched = allText.length === 0 || allText.every((token: string) => lower.includes(String(token).toLowerCase()));
    const anyMatched = anyText.length === 0 || anyText.some((token: string) => lower.includes(String(token).toLowerCase()));
    return allMatched && anyMatched && (allText.length > 0 || anyText.length > 0);
  }

  private async expectEntityPresence(page: Page, expected: string, shouldExist: boolean, timeout: number): Promise<void> {
    const tokens = expected.split("|").map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) throw new Error("Entity assertion requires at least one fingerprint token");
    const deadline = Date.now() + timeout;
    let matched = false;
    while (Date.now() < deadline) {
      const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      const lower = bodyText.toLowerCase();
      matched = tokens.every((token) => lower.includes(token.toLowerCase()));
      if (matched === shouldExist) return;
      await page.waitForTimeout(250);
    }
    throw new Error("Expected entity fingerprint " + tokens.join(" | ") + (shouldExist ? " to be visible" : " to be absent"));
  }
}

// Default export lets the server load and instantiate this flow via dynamic import.
export default ${className};
`;
}

function generateActionCode(action: RecordedAction, index: number, workflow: RecordedWorkflow): string {
  const indent = "      ";
  const stepComment = `${indent}// Step ${index + 1}: ${action.description ?? action.type}`;
  const timeout = action.timeout ?? workflow.config.defaultTimeout;
  const coreIndent = "        ";
  // Feature 1: scope element resolution to an iframe when one was recorded.
  const frame = JSON.stringify(action.frameSelector);
  const selectors = JSON.stringify(action.selectors);
  const selectorCandidates = JSON.stringify(action.selectorCandidates ?? []);
  const selectMetadata = JSON.stringify(action.selectMetadata ?? {});
  let core: string;

  switch (action.type) {
    case "navigate": {
      const path = action.url ? new URL(action.url).pathname + new URL(action.url).hash : "/";
      const waitForUrl = action.waitForUrl
        // Feature 10: assert the navigation actually landed where expected.
        ? `\n${coreIndent}await page.waitForURL((url) => url.href.includes(${JSON.stringify(action.waitForUrl)}), { timeout: ${timeout} }).catch(() => undefined);`
        : "";
      core = `${coreIndent}await page.goto(\`\${this.options.config.zoom.webBaseUrl.replace(/\\/$/, "")}${path}\`, { waitUntil: "domcontentloaded", timeout: ${timeout} });
${coreIndent}await page.waitForLoadState("networkidle", { timeout: ${timeout} }).catch(() => undefined);${waitForUrl}
${coreIndent}await dismissBlockingZoomPopups(page, this.options.logger);`;
      break;
    }

    case "click": {
      const ariaState = action.ariaState ? `, ${JSON.stringify(action.ariaState)}` : "";
      const clickCall = `${coreIndent}await this.clickElement(page, ${selectors}, ${selectorCandidates}, ${timeout}, ${frame}${ariaState});`;
      // Feature 2: wait for the XHR/fetch the click triggers instead of a fixed sleep.
      core = wrapNetworkWait(action, clickCall, coreIndent, timeout);
      break;
    }

    case "fill": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)}, activeAccountId)`
        : JSON.stringify(action.value ?? "");
      core = `${coreIndent}await this.fillField(page, ${selectors}, ${selectorCandidates}, ${value}, ${timeout}, ${frame});`;
      break;
    }

    case "select": {
      const value = action.value?.includes("{{")
        ? `this.resolveValue(${JSON.stringify(action.value)}, activeAccountId)`
        : JSON.stringify(action.value ?? "");
      core = `${coreIndent}await this.selectOption(page, ${selectors}, ${selectorCandidates}, ${value}, ${timeout}, ${frame}, ${selectMetadata});`;
      break;
    }

    case "selectRows": {
      core = `${coreIndent}await this.selectRows(page, ${JSON.stringify(action.rowSelection ?? { mode: "firstAvailable", count: 1 })}, ${timeout}, workflowState);`;
      break;
    }

    case "upload":
      core = `${coreIndent}// File upload — path resolved from config.documents
${coreIndent}await this.uploadFile(page, ${selectors}, ${selectorCandidates}, ${timeout}, ${frame});`;
      break;

    case "hover":
      // Feature 4: hover to reveal menus/tooltips.
      core = `${coreIndent}await this.hoverElement(page, ${selectors}, ${selectorCandidates}, ${timeout}, ${frame});`;
      break;

    case "press":
      // Feature 4: keyboard navigation.
      core = `${coreIndent}await this.pressKey(page, ${selectors}, ${selectorCandidates}, ${JSON.stringify(action.key ?? "Enter")}, ${timeout}, ${frame});`;
      break;

    case "download": {
      // Feature 7: capture the file via Playwright's download event.
      const label = slugify(action.description ?? `download-${index + 1}`);
      core = `${coreIndent}await this.downloadFile(page, ${selectors}, ${selectorCandidates}, ${timeout}, ${frame}, \`\${artifactBase}-${label}\`);`;
      break;
    }

    case "dialog": {
      // Feature 8: register a one-shot native dialog handler before the next step triggers it.
      const accept = action.dialogAction !== "dismiss";
      const promptText = action.dialogPromptText ? JSON.stringify(action.dialogPromptText) : "undefined";
      core = `${coreIndent}page.once("dialog", (dialog) => { void dialog.${accept ? `accept(${promptText})` : "dismiss()"}.catch(() => undefined); });`;
      break;
    }

    case "wait":
      core = `${coreIndent}await page.waitForTimeout(${Math.min(Math.max(action.waitMs ?? timeout, 250), 60_000)});`;
      break;

    case "assert":
      return wrapGeneratedAction(action, stepComment, generateAssertionActionCode(action, coreIndent, timeout), workflow, generateAfterActionAssertions(action, workflow));

    case "screenshot": {
      const label = slugify(action.screenshotLabel ?? action.description ?? `step-${index + 1}`);
      // Feature 9: scope the screenshot to the matched element when requested.
      core = action.elementScreenshot
        ? `${coreIndent}await this.elementScreenshot(page, ${selectors}, ${selectorCandidates}, \`\${artifactBase}-${label}.png\`, ${timeout}, ${frame});`
        : `${coreIndent}await page.screenshot({ path: \`\${artifactBase}-${label}.png\`, fullPage: true });`;
      break;
    }

    case "dismiss":
      core = `${coreIndent}await dismissBlockingZoomPopups(page, this.options.logger);`;
      break;

    case "if": {
      // Control flow: run thenActions when the predicate holds, else elseActions.
      const cond = JSON.stringify(action.ifCondition ?? { kind: "always" });
      const thenCode = (action.thenActions ?? []).map((child, i) => generateActionCode(child, i, workflow)).join("\n\n");
      const elseChildren = action.elseActions ?? [];
      const elseCode = elseChildren.map((child, i) => generateActionCode(child, i, workflow)).join("\n\n");
      const elseBlock = elseChildren.length > 0 ? ` else {\n${elseCode}\n${indent}}` : "";
      return `${stepComment}
${indent}if (await this.evalPredicate(page, ${cond})) {
${thenCode}
${indent}}${elseBlock}`;
    }

    default:
      core = `${coreIndent}// TODO: Implement ${action.type} action`;
      break;
  }

  return wrapGeneratedAction(action, stepComment, core, workflow, generateAfterActionAssertions(action, workflow));
}

/**
 * Generate workflow.assertions[] whose afterAction matches this step, so a
 * failed submit is detected instead of being reported as success.
 */
function generateAfterActionAssertions(action: RecordedAction, workflow: RecordedWorkflow): string {
  const matching = workflow.assertions.filter((assertion) => assertion.afterAction === action.id);
  return matching.map((assertion) => generateWorkflowAssertionCode(assertion)).join("\n");
}

function generateWorkflowAssertionCode(assertion: RecordedWorkflow["assertions"][number]): string {
  const indent = "      ";
  const ci = "        ";
  const t = assertion.timeout;
  const onFailure = assertion.onFailure ?? "screenshot";

  const expectedExpression = assertion.expected.includes("{{selected.")
    ? `this.resolveExpected(${JSON.stringify(assertion.expected)}, workflowState)`
    : JSON.stringify(assertion.expected);
  const body = generateWorkflowAssertionBody(assertion, expectedExpression, ci);

  if (onFailure === "skip") {
    return `${indent}// Auto verification (${assertion.type})
${indent}try {
${body}
${indent}} catch (error) {
${indent}  this.options.logger.warn("Verification skipped after failure", { error: error instanceof Error ? error.message : String(error) });
${indent}}`;
  }
  if (onFailure === "screenshot") {
    return `${indent}// Auto verification (${assertion.type})
${indent}try {
${body}
${indent}} catch (error) {
${indent}  await page.screenshot({ path: \`\${artifactBase}-verify-failure.png\`, fullPage: true }).catch(() => undefined);
${indent}  throw error;
${indent}}`;
  }
  return `${indent}// Auto verification (${assertion.type})
${body}`;
}

function generateWorkflowAssertionBody(
  assertion: RecordedWorkflow["assertions"][number],
  expectedExpression: string,
  indent: string
): string {
  if (assertion.type === "entityExists" || assertion.type === "entityAbsent" || assertion.type === "entityState") {
    const shouldExist = assertion.type === "entityAbsent" ? "false" : "true";
    return `${indent}await this.expectEntityPresence(page, ${expectedExpression}, ${shouldExist}, ${assertion.timeout});`;
  }
  return generateAssertionBody({
    assertionType: assertion.type,
    expected: assertion.expected,
    timeout: assertion.timeout,
    indent
  });
}

/**
 * Feature 2: wrap an action that triggers a known XHR/fetch so the flow waits for
 * that response (with the action) rather than guessing with a fixed timeout.
 */
function wrapNetworkWait(action: RecordedAction, call: string, indent: string, timeout: number): string {
  if (!action.networkWaitUrl) return call;
  return `${indent}const __networkWait = page.waitForResponse((response) => response.url().includes(${JSON.stringify(action.networkWaitUrl)}), { timeout: ${timeout} }).catch(() => undefined);
${call}
${indent}await __networkWait;`;
}

function wrapGeneratedAction(action: RecordedAction, stepComment: string, core: string, workflow: RecordedWorkflow, afterAssertions = ""): string {
  const indent = "      ";
  const condition = JSON.stringify(action.condition);
  const selectors = JSON.stringify(action.selectors);
  const policy = JSON.stringify({
    retryCount: action.retryCount ?? 0,
    retryDelayMs: action.retryDelayMs ?? workflow.config.defaultTimeout / 10,
    continueOnFailure: action.continueOnFailure ?? action.onFailure === "skip",
    screenshotOnFailure: action.screenshotOnFailure ?? action.onFailure === "screenshot",
    readyTimeoutMs: action.timeout ?? workflow.config.defaultTimeout
  });
  const description = JSON.stringify(action.description ?? action.type);

  // Phase 4: compound predicate guard. Only emitted when a guard is present.
  // The skip-account decision is resolved at compile time to avoid a dead
  // literal comparison in the generated code.
  const accountSkip = action.guardElse === "skipAccount"
    ? `
${indent}  if (!guardOk) {
${indent}    this.options.logger.info("Step guard not satisfied; skipping account", { step: ${description} });
${indent}    return { status: "skipped", message: "Guard not satisfied" };
${indent}  }`
    : "";
  const guardBlock = action.guard
    ? `
${indent}  const guardOk = await this.evalPredicate(page, ${JSON.stringify(action.guard)});${accountSkip}`
    : "";
  const guardCondition = action.guard ? " && guardOk" : "";

  // Dry-run safety: skip mutating/commit steps so a dry run validates without changing data.
  const dryRunSkip = action.skipInDryRun ?? isMutatingForDryRun(action);
  const executeCall = `await this.executeRecordedStep(page, artifactBase, ${description}, ${policy}, async () => {
${core}
${indent}    });`;
  const executeAndAssert = afterAssertions ? `${executeCall}
${afterAssertions}` : executeCall;
  const body = dryRunSkip
    ? `if (this.options.config.runtime.dryRun) {
${indent}      dryRunSkipped = true;
${indent}      this.options.logger.info("Dry run: skipping mutating step", { step: ${description} });
${indent}    } else {
${indent}      ${executeAndAssert}
${indent}    }`
    : executeAndAssert;

  return `${stepComment}
${indent}{
${indent}  const skip = await this.shouldSkipRecordedStep(page, ${condition}, ${selectors});
${indent}  if (skip === "account") {
${indent}    this.options.logger.info("Recorded workflow skip condition matched", { step: ${description} });
${indent}    return { status: "skipped", message: "Skip condition matched" };
${indent}  }${guardBlock}
${indent}  if (skip !== "step"${guardCondition}) {
${indent}    ${body}
${indent}  }
${indent}}`;
}

/** A click whose label looks like a commit/mutation (skipped during dry runs by default). */
function isMutatingForDryRun(action: RecordedAction): boolean {
  if (action.type !== "click" && action.type !== "upload") return false;
  const name = action.selectors.role?.name ?? action.selectors.text ?? action.description ?? "";
  return /\b(save|submit|create|confirm|apply|delete|remove|invite|provision)\b/i.test(name);
}

function generateAssertionActionCode(action: RecordedAction, indent: string, timeout: number): string {
  const actionTimeout = action.timeout ?? timeout;
  const onFailure = action.onFailure ?? "screenshot";
  // Feature 6: assertions use Playwright's auto-waiting locators (waitFor / polling)
  // so they retry until the timeout instead of checking once.
  const assertionBody = generateAssertionBody({
    assertionType: action.assertionType,
    expected: action.expected ?? action.value ?? "",
    timeout: actionTimeout,
    indent,
    selectors: action.selectors,
    selectorCandidates: action.selectorCandidates
  });

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
    if (["navigate", "wait", "assert", "screenshot", "dismiss", "dialog"].includes(action.type)) continue;
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

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function pascalCase(slug: string): string {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}
