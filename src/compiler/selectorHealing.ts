/**
 * Selector Healing — when a primary selector fails, attempts fuzzy matching
 * to find the intended element using alternative strategies.
 *
 * This module generates the healing code that gets embedded into compiled
 * workflow flows, and provides runtime healing utilities.
 */
import type { Page, Locator } from "playwright";
import type { SelectorStrategy } from "./types.js";

export interface HealingResult {
  found: boolean;
  locator?: Locator;
  strategy: string;
  healed: boolean;
  originalStrategy?: string;
  confidence: number;
}

export interface HealingReport {
  totalActions: number;
  healedActions: number;
  failedActions: number;
  healings: Array<{
    actionId: string;
    description: string;
    originalStrategy: string;
    healedStrategy: string;
    confidence: number;
  }>;
}

/**
 * Attempt to find an element using multiple selector strategies with fallback.
 * Returns the first successful match with metadata about which strategy worked.
 */
export async function findWithHealing(
  page: Page,
  selectors: SelectorStrategy,
  timeout: number = 5_000
): Promise<HealingResult> {
  const strategies = buildStrategyChain(selectors);

  // Try each strategy in priority order
  for (const { name, locator } of strategies) {
    try {
      await locator(page).waitFor({ state: "visible", timeout: Math.min(timeout, 3_000) });
      return {
        found: true,
        locator: locator(page),
        strategy: name,
        healed: name !== strategies[0].name,
        originalStrategy: strategies[0].name,
        confidence: name === strategies[0].name ? 1.0 : 0.8
      };
    } catch {
      continue;
    }
  }

  // All exact strategies failed — try fuzzy matching
  const fuzzyResult = await tryFuzzyMatch(page, selectors, timeout);
  if (fuzzyResult) {
    return fuzzyResult;
  }

  return { found: false, strategy: "none", healed: false, confidence: 0 };
}

/**
 * Build the ordered chain of selector strategies to try.
 */
function buildStrategyChain(selectors: SelectorStrategy): Array<{ name: string; locator: (page: Page) => Locator }> {
  const chain: Array<{ name: string; locator: (page: Page) => Locator }> = [];

  if (selectors.role) {
    const { role, name } = selectors.role;
    chain.push({
      name: `role:${role}[${name ?? ""}]`,
      locator: (page) => name
        ? page.getByRole(role as any, { name: new RegExp(escapeRegex(name), "i") }).first()
        : page.getByRole(role as any).first()
    });
  }

  if (selectors.label) {
    chain.push({
      name: `label:${selectors.label}`,
      locator: (page) => page.getByLabel(new RegExp(escapeRegex(selectors.label!), "i")).first()
    });
  }

  if (selectors.text) {
    chain.push({
      name: `text:${selectors.text}`,
      locator: (page) => page.getByText(new RegExp(escapeRegex(selectors.text!), "i")).first()
    });
  }

  if (selectors.testId) {
    chain.push({
      name: `testId:${selectors.testId}`,
      locator: (page) => page.getByTestId(selectors.testId!).first()
    });
  }

  if (selectors.css) {
    chain.push({
      name: `css:${selectors.css}`,
      locator: (page) => page.locator(selectors.css!).first()
    });
  }

  return chain;
}

/**
 * Fuzzy matching — when all exact selectors fail, try variations:
 * 1. Partial text match (first 3 words of the name)
 * 2. Same role without name constraint
 * 3. Similar label (case-insensitive, trimmed)
 */
async function tryFuzzyMatch(
  page: Page,
  selectors: SelectorStrategy,
  timeout: number
): Promise<HealingResult | undefined> {
  const shortTimeout = Math.min(timeout, 2_000);

  // Fuzzy 1: Partial text match on role name
  if (selectors.role?.name) {
    const words = selectors.role.name.split(/\s+/).slice(0, 3).join("\\s+");
    const partialPattern = new RegExp(words, "i");
    try {
      const locator = page.getByRole(selectors.role.role as any, { name: partialPattern }).first();
      await locator.waitFor({ state: "visible", timeout: shortTimeout });
      return {
        found: true,
        locator,
        strategy: `fuzzy:role-partial[${words}]`,
        healed: true,
        originalStrategy: `role:${selectors.role.role}[${selectors.role.name}]`,
        confidence: 0.6
      };
    } catch { /* continue */ }
  }

  // Fuzzy 2: Same role, any name (if there's only one visible)
  if (selectors.role) {
    try {
      const allWithRole = page.getByRole(selectors.role.role as any);
      const visibleCount = await allWithRole.count();
      if (visibleCount === 1) {
        const locator = allWithRole.first();
        await locator.waitFor({ state: "visible", timeout: shortTimeout });
        return {
          found: true,
          locator,
          strategy: `fuzzy:role-only[${selectors.role.role}]`,
          healed: true,
          originalStrategy: `role:${selectors.role.role}[${selectors.role.name ?? ""}]`,
          confidence: 0.4
        };
      }
    } catch { /* continue */ }
  }

  // Fuzzy 3: Broader text search
  if (selectors.text) {
    const firstWord = selectors.text.split(/\s+/)[0];
    if (firstWord && firstWord.length > 2) {
      try {
        const locator = page.getByText(new RegExp(escapeRegex(firstWord), "i")).first();
        await locator.waitFor({ state: "visible", timeout: shortTimeout });
        return {
          found: true,
          locator,
          strategy: `fuzzy:text-partial[${firstWord}]`,
          healed: true,
          originalStrategy: `text:${selectors.text}`,
          confidence: 0.3
        };
      } catch { /* continue */ }
    }
  }

  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate the TypeScript code for selector healing that gets embedded
 * into compiled workflow flows.
 */
export function generateHealingCode(): string {
  return `
  private healingReport: Array<{ actionDescription: string; originalStrategy: string; healedStrategy: string; confidence: number }> = [];

  /** Feature 1: resolve element queries against an iframe when a frame selector was recorded. */
  private scope(page: Page, frameSelector?: string): import("playwright").Page | import("playwright").FrameLocator {
    return frameSelector ? page.frameLocator(frameSelector) : page;
  }

  private async findElement(root: import("playwright").Page | import("playwright").FrameLocator, selectors: Record<string, any>, timeout: number): Promise<import("playwright").Locator> {
    // Feature 3: when an ordinal was recorded, target that match; otherwise the first.
    const pick = (base: import("playwright").Locator): import("playwright").Locator =>
      typeof selectors.nth === "number" ? base.nth(selectors.nth) : base.first();

    const strategies: Array<{ name: string; locator: () => import("playwright").Locator }> = [];

    if (selectors.role) {
      const { role, name } = selectors.role;
      strategies.push({
        name: \`role:\${role}[\${name ?? ""}]\`,
        locator: () => pick(name
          ? root.getByRole(role, { name: new RegExp(name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i") })
          : root.getByRole(role))
      });
    }
    if (selectors.label) {
      strategies.push({
        name: \`label:\${selectors.label}\`,
        locator: () => pick(root.getByLabel(new RegExp(selectors.label.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i")))
      });
    }
    if (selectors.text) {
      strategies.push({
        name: \`text:\${selectors.text}\`,
        locator: () => pick(root.getByText(new RegExp(selectors.text.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i")))
      });
    }
    if (selectors.testId) {
      strategies.push({ name: \`testId:\${selectors.testId}\`, locator: () => pick(root.getByTestId(selectors.testId)) });
    }
    if (selectors.css) {
      strategies.push({ name: \`css:\${selectors.css}\`, locator: () => pick(root.locator(selectors.css)) });
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

    throw new Error(\`Element not found with any selector strategy: \${JSON.stringify(selectors)}\`);
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
    const option = root.getByRole("option", { name: new RegExp(value.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i") }).first();
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
    await download.saveAs(\`\${artifactBase}-\${suggested}\`);
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
`;
}
