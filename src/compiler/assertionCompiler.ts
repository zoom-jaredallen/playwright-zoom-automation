import type { AssertionType, SelectorCandidate, SelectorStrategy } from "./types.js";

export interface AssertionBodyInput {
  assertionType: AssertionType | "responseOk" | undefined;
  expected: string;
  timeout: number;
  indent: string;
  selectors?: SelectorStrategy;
  selectorCandidates?: SelectorCandidate[];
}

export function generateAssertionBody(input: AssertionBodyInput): string {
  const expected = JSON.stringify(input.expected);
  const selectorJson = JSON.stringify(input.selectors ?? {});
  const candidatesJson = JSON.stringify(input.selectorCandidates ?? []);
  const timeout = input.timeout;
  const indent = input.indent;

  switch (input.assertionType) {
    case "responseOk":
      return `${indent}// (responseOk assertion is not enforced at replay time)`;
    case "urlContains":
      return `${indent}await page.waitForURL((url) => url.href.includes(${expected}), { timeout: ${timeout} });`;
    case "urlMatches":
      return `${indent}await page.waitForURL((url) => new RegExp(${expected}).test(url.href), { timeout: ${timeout} });`;
    case "elementVisible":
      return hasUsableSelector(input.selectors)
        ? `${indent}{
${indent}  const element = await this.findElement(page, ${selectorJson}, ${candidatesJson}, ${timeout});
${indent}  await element.waitFor({ state: "visible", timeout: ${timeout} });
${indent}}`
        : `${indent}await page.locator(${expected}).first().waitFor({ state: "visible", timeout: ${timeout} });`;
    case "fieldValue":
    case "hasValue":
      return hasUsableSelector(input.selectors)
        ? `${indent}{
${indent}  const element = await this.findElement(page, ${selectorJson}, ${candidatesJson}, ${timeout});
${indent}  const value = await element.inputValue({ timeout: ${timeout} });
${indent}  if (value !== ${expected}) throw new Error(\`Expected field value "\${value}" to equal ${input.expected}\`);
${indent}}`
        : `${indent}await this.expectFieldValue(page, ${expected}, ${timeout});`;
    case "tableRowContains":
      return `${indent}await page.locator("tr, [role='row']", { hasText: ${expected} }).first().waitFor({ state: "visible", timeout: ${timeout} });`;
    case "addressStatusEquals":
      return `${indent}await page.locator("tr, [role='row']", { hasText: ${expected} }).first().waitFor({ state: "visible", timeout: ${timeout} });`;
    case "entityExists":
      return `${indent}await this.expectEntityPresence(page, ${expected}, true, ${timeout});`;
    case "entityAbsent":
      return `${indent}await this.expectEntityPresence(page, ${expected}, false, ${timeout});`;
    case "entityState":
      return `${indent}await this.expectEntityPresence(page, ${expected}, true, ${timeout});`;
    case "toastVisible":
      return `${indent}await page.locator("[role='status'], [role='alert'], .toast, .zm-toast, .zmu-toast, [class*='toast'], [class*='Toast'], [class*='banner']", { hasText: ${expected} }).first().waitFor({ state: "visible", timeout: ${timeout} });`;
    case "hasText":
    case "textVisible":
    default:
      return `${indent}await page.getByText(${expected}, { exact: false }).first().waitFor({ state: "visible", timeout: ${timeout} });`;
  }
}

function hasUsableSelector(selectors: SelectorStrategy | undefined): boolean {
  return Boolean(selectors && (selectors.role || selectors.label || selectors.text || selectors.testId || selectors.css || selectors.xpath));
}
