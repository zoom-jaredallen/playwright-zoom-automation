import type { WorkflowQualityReport } from "@zoom-automation/workflow-core";

export interface PublishReviewInput {
  quality: WorkflowQualityReport;
  warningsAccepted: boolean;
}

export interface PublishReview {
  quality: WorkflowQualityReport;
  publishable: boolean;
  warnings: string[];
}

export function createPublishReview(input: PublishReviewInput): PublishReview {
  const warnings = [
    input.quality.selectorStability < 70 ? "Selector stability is below 70%." : undefined,
    input.quality.assertionCoverage < 70 ? "Assertion coverage is below 70%." : undefined,
    input.quality.evidenceCoverage < 25 ? "Evidence coverage is low." : undefined,
    input.quality.riskySteps > 0 ? `${input.quality.riskySteps} risky step(s) need review.` : undefined,
    input.quality.hardcodedValues > 0 ? `${input.quality.hardcodedValues} hardcoded value(s) should be parameterized.` : undefined,
    input.quality.unsupportedBrowserPreflightSteps > 0 ? "Some steps cannot be tested in browser preflight." : undefined
  ].filter(Boolean) as string[];

  return {
    quality: input.quality,
    publishable: warnings.length === 0 || input.warningsAccepted,
    warnings
  };
}
