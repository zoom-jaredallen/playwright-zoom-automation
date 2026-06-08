import type { RecordedAction, RecordedWorkflow } from "./types.js";
import { generateAssertionBody } from "./assertionCompiler.js";
import { slugify } from "./nameUtils.js";

export function generateAfterActionAssertions(action: RecordedAction, workflow: RecordedWorkflow): string {
  const matching = workflow.assertions.filter((assertion) => assertion.afterAction === action.id);
  return matching.map((assertion) => generateWorkflowAssertionCode(assertion)).join("\n");
}

export function generateWorkflowAssertionCode(assertion: RecordedWorkflow["assertions"][number]): string {
  const indent = "      ";
  const ci = "        ";
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

export function generateAssertionActionCode(action: RecordedAction, indent: string, timeout: number): string {
  const actionTimeout = action.timeout ?? timeout;
  const onFailure = action.onFailure ?? "screenshot";
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
