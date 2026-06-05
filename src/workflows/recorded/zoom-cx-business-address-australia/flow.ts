import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../../automation/types.js";
import type { AppConfig } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import type { StorageState } from "../../../zoom/auth.js";
import { impersonateSubAccount } from "../../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../../zoom/popups.js";

export interface ZoomCxBusinessAddressAustraliaFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  getMasterStorageState?: () => StorageState;
  config: AppConfig;
  logger: Logger;
}

export class ZoomCxBusinessAddressAustraliaFlow implements AutomationFlow {
  readonly name = "zoom-cx-business-address-australia";

  constructor(private readonly options: ZoomCxBusinessAddressAustraliaFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const activeAccountId = input.account.id;
    let dryRunSkipped = false;
    const context = await this.options.browser.newContext({
      storageState: this.options.getMasterStorageState?.() ?? this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-zoom-cx-business-address-australia-${Date.now()}`
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

    // Assertions are checked inline after their triggering actions

      // ─── Recorded Actions ────────────────────────────────────────────
      // Step 1: Navigate to Business Address & Documents - Zoom
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Navigate to Business Address & Documents - Zoom" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Navigate to Business Address & Documents - Zoom", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1`, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        await dismissBlockingZoomPopups(page, this.options.logger);
          });
        }
      }
      // Auto verification (urlContains)
        await page.waitForURL((url) => url.href.includes("#/business-address?pageSize=15&pageNumber=1"), { timeout: 15000 });

      await context.tracing.stop();
      return dryRunSkipped
        ? { status: "skipped", message: "Dry run: mutating steps were not submitted" }
        : { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: `${artifactBase}-failure.png`, fullPage: true }).catch(() => undefined);
      await context.tracing.stop({ path: `${artifactBase}-trace.zip` }).catch(() => undefined);
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
      throw new Error(`Parameter "${paramName}" could not be resolved from config`);
    }
    return value;
  }

  private resolveValue(template: string, activeAccountId?: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, paramName) => this.resolve(paramName.trim(), activeAccountId));
  }


  private healingReport: Array<{ actionDescription: string; originalStrategy: string; healedStrategy: string; confidence: number }> = [];

  /** Feature 1: resolve element queries against an iframe when a frame selector was recorded. */
  private scope(page: Page, frameSelector?: string): import("playwright").Page | import("playwright").FrameLocator {
    return frameSelector ? page.frameLocator(frameSelector) : page;
  }

  private async findElement(root: import("playwright").Page | import("playwright").FrameLocator, selectors: Record<string, any>, timeout: number): Promise<import("playwright").Locator> {
    const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Anchors: scope to a container (e.g. the row whose Name contains "michael.chen")
    // before resolving the normal strategies. "within" is the primary path; other
    // relationships approximate by scoping to the same container.
    let scope: any = root;
    if (selectors.anchor && (selectors.anchor.text || selectors.anchor.scopeRole)) {
      const anchor = selectors.anchor;
      let container: any = root.getByRole(anchor.scopeRole || "row");
      if (anchor.text) {
        container = container.filter({ hasText: new RegExp(esc(anchor.text), "i") });
      }
      scope = container.first();
    }

    // When an ordinal was recorded, target that match; otherwise the first.
    const pick = (base: import("playwright").Locator): import("playwright").Locator =>
      typeof selectors.nth === "number" ? base.nth(selectors.nth) : base.first();

    const strategies: Array<{ name: string; locator: () => import("playwright").Locator }> = [];

    if (selectors.role) {
      const { role, name, exact, checked, expanded, selected, pressed } = selectors.role;
      const opts: any = {};
      if (name) {
        opts.name = exact ? name : new RegExp(esc(name), "i");
        if (exact) opts.exact = true;
      }
      // ARIA-state constraints disambiguate e.g. the *checked* checkbox.
      if (typeof checked === "boolean") opts.checked = checked;
      if (typeof expanded === "boolean") opts.expanded = expanded;
      if (typeof selected === "boolean") opts.selected = selected;
      if (typeof pressed === "boolean") opts.pressed = pressed;
      strategies.push({
        name: `role:${role}[${name ?? ""}]`,
        locator: () => pick(scope.getByRole(role, opts))
      });
    }
    if (selectors.label) {
      strategies.push({
        name: `label:${selectors.label}`,
        locator: () => pick(scope.getByLabel(new RegExp(esc(selectors.label), "i")))
      });
    }
    if (selectors.text) {
      strategies.push({
        name: `text:${selectors.text}`,
        locator: () => pick(scope.getByText(new RegExp(esc(selectors.text), "i")))
      });
    }
    if (selectors.testId) {
      strategies.push({ name: `testId:${selectors.testId}`, locator: () => pick(scope.getByTestId(selectors.testId)) });
    }
    if (selectors.css) {
      strategies.push({ name: `css:${selectors.css}`, locator: () => pick(scope.locator(selectors.css)) });
    }

    for (const strategy of strategies) {
      try {
        const el = strategy.locator();
        await el.waitFor({ state: "visible", timeout: Math.min(timeout, 3000) });
        if (strategy !== strategies[0]) {
          this.healingReport.push({ actionDescription: "", originalStrategy: strategies[0].name, healedStrategy: strategy.name, confidence: 0.8 });
          this.options.logger.warn("Selector healed", { original: strategies[0].name, healed: strategy.name });
        }
        return el;
      } catch { continue; }
    }

    throw new Error(`Element not found with any selector strategy: ${JSON.stringify(selectors)}`);
  }

  /** Feature 5: read an element's current ARIA toggle state. */
  private async isAriaStateSatisfied(el: import("playwright").Locator, ariaState: Record<string, any>): Promise<boolean> {
    const matches = async (attr: string, want: boolean | undefined): Promise<boolean> => {
      if (want === undefined) return true;
      const value = await el.getAttribute(attr).catch(() => null);
      return value === String(want);
    };
    return (await matches("aria-checked", ariaState.checked))
      && (await matches("aria-expanded", ariaState.expanded))
      && (await matches("aria-selected", ariaState.selected));
  }

  private async clickElement(page: Page, selectors: Record<string, any>, timeout: number, frameSelector?: string, ariaState?: Record<string, any>): Promise<void> {
    await dismissBlockingZoomPopups(page, this.options.logger);
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    // Feature 5: skip the click if the element is already in the desired ARIA state (idempotent re-runs).
    if (ariaState && await this.isAriaStateSatisfied(el, ariaState)) {
      this.options.logger.info("Skipping click; element already in desired state", { ariaState });
      return;
    }
    await el.click();
  }

  private async fillField(page: Page, selectors: Record<string, any>, value: string, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    await el.fill(value, { timeout });
  }

  private async selectOption(page: Page, selectors: Record<string, any>, value: string, timeout: number, frameSelector?: string): Promise<void> {
    const root = this.scope(page, frameSelector);
    const el = await this.findElement(root, selectors, timeout);
    await el.click({ timeout });
    const option = root.getByRole("option", { name: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
  }

  private async uploadFile(page: Page, selectors: Record<string, any>, timeout: number, frameSelector?: string): Promise<void> {
    const docPath = this.options.config.documents.businessVerificationPath ?? this.options.config.documents.idPath;
    if (!docPath) return;
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    await el.setInputFiles(docPath);
  }

  /** Feature 4: hover to reveal menus/tooltips. */
  private async hoverElement(page: Page, selectors: Record<string, any>, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    await el.hover({ timeout });
  }

  /** Feature 4: press a key, scoped to an element when one was recorded. */
  private async pressKey(page: Page, selectors: Record<string, any>, key: string, timeout: number, frameSelector?: string): Promise<void> {
    if (!selectors || Object.keys(selectors).length === 0) {
      await page.keyboard.press(key);
      return;
    }
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    await el.press(key, { timeout });
  }

  /** Feature 7: click a control and capture the resulting browser download as an artifact. */
  private async downloadFile(page: Page, selectors: Record<string, any>, timeout: number, frameSelector: string | undefined, artifactBase: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    const downloadPromise = page.waitForEvent("download", { timeout });
    await el.click();
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    await download.saveAs(`${artifactBase}-${suggested}`);
    this.options.logger.info("Captured download", { file: suggested });
  }

  /** Feature 9: capture a screenshot scoped to the matched element. */
  private async elementScreenshot(page: Page, selectors: Record<string, any>, path: string, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, timeout);
    await el.screenshot({ path });
  }

  /** Feature 6: auto-retrying field-value assertion (polls until the timeout). */
  private async expectFieldValue(page: Page, expected: string, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const fields = page.locator("input, textarea");
      const count = await fields.count();
      for (let index = 0; index < count; index++) {
        const value = await fields.nth(index).inputValue({ timeout: 1_000 }).catch(() => "");
        if (value.includes(expected)) return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error("Expected a field value to contain " + expected);
  }

  /** Compound condition evaluation (IF/AND/OR/NOT) used by step guards and IF blocks. */
  private async evalPredicate(page: Page, predicate: any): Promise<boolean> {
    if (!predicate || predicate.kind === "always") return true;
    const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    switch (predicate.kind) {
      case "and": {
        const results = await Promise.all((predicate.operands ?? []).map((p: any) => this.evalPredicate(page, p)));
        return results.every(Boolean);
      }
      case "or": {
        const results = await Promise.all((predicate.operands ?? []).map((p: any) => this.evalPredicate(page, p)));
        return results.some(Boolean);
      }
      case "not":
        return !(await this.evalPredicate(page, predicate.operand));
      case "urlContains":
        return page.url().includes(predicate.text ?? "");
      case "textVisible":
        return page.getByText(new RegExp(esc(predicate.text ?? ""), "i")).first().isVisible().catch(() => false);
      case "elementVisible":
        try {
          const el = await this.findElement(page, predicate.selector, 3000);
          return await el.isVisible();
        } catch { return false; }
      case "fieldEmpty":
        try {
          const el = await this.findElement(page, predicate.selector, 3000);
          return (await el.inputValue().catch(() => "")).trim() === "";
        } catch { return false; }
      case "fieldValue":
        try {
          const el = await this.findElement(page, predicate.selector, 3000);
          const value = await el.inputValue().catch(() => "");
          if (predicate.equals !== undefined) return value === predicate.equals;
          if (predicate.contains !== undefined) return value.includes(predicate.contains);
          return value.trim() !== "";
        } catch { return false; }
      default:
        return true;
    }
  }


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
      await page.screenshot({ path: `${artifactBase}-${description.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-failure.png`, fullPage: true }).catch(() => undefined);
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

// Default export lets the server load and instantiate this flow via dynamic import.
export default ZoomCxBusinessAddressAustraliaFlow;
