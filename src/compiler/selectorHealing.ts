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

  private async findElement(page: Page, selectors: Record<string, any>, timeout: number): Promise<import("playwright").Locator> {
    const strategies: Array<{ name: string; locator: () => import("playwright").Locator }> = [];

    if (selectors.role) {
      const { role, name } = selectors.role;
      strategies.push({
        name: \`role:\${role}[\${name ?? ""}]\`,
        locator: () => name
          ? page.getByRole(role, { name: new RegExp(name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i") }).first()
          : page.getByRole(role).first()
      });
    }
    if (selectors.label) {
      strategies.push({
        name: \`label:\${selectors.label}\`,
        locator: () => page.getByLabel(new RegExp(selectors.label.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i")).first()
      });
    }
    if (selectors.text) {
      strategies.push({
        name: \`text:\${selectors.text}\`,
        locator: () => page.getByText(new RegExp(selectors.text.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i")).first()
      });
    }
    if (selectors.testId) {
      strategies.push({ name: \`testId:\${selectors.testId}\`, locator: () => page.getByTestId(selectors.testId).first() });
    }
    if (selectors.css) {
      strategies.push({ name: \`css:\${selectors.css}\`, locator: () => page.locator(selectors.css).first() });
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

  private async clickElement(page: Page, selectors: Record<string, any>, timeout: number): Promise<void> {
    await dismissBlockingZoomPopups(page, this.options.logger);
    const el = await this.findElement(page, selectors, timeout);
    await el.click();
  }

  private async fillField(page: Page, selectors: Record<string, any>, value: string, timeout: number): Promise<void> {
    const el = await this.findElement(page, selectors, timeout);
    await el.fill(value, { timeout });
  }

  private async selectOption(page: Page, selectors: Record<string, any>, value: string, timeout: number): Promise<void> {
    const el = await this.findElement(page, selectors, timeout);
    await el.click({ timeout });
    const option = page.getByRole("option", { name: new RegExp(value.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i") }).first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
  }

  private async uploadFile(page: Page, selectors: Record<string, any>, timeout: number): Promise<void> {
    const docPath = this.options.config.documents.businessVerificationPath ?? this.options.config.documents.idPath;
    if (!docPath) return;
    const el = await this.findElement(page, selectors, timeout);
    await el.setInputFiles(docPath);
  }
`;
}
