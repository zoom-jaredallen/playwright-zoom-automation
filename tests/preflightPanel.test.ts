import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BulkPreflightView } from "../src/ui/api.js";
import { PreflightPanel } from "../src/ui/components/PreflightPanel.js";

describe("PreflightPanel", () => {
  it("shows the highest-severity issue across all workflow outcomes for an account", () => {
    const preflight: BulkPreflightView = {
      summary: { willRun: 0, willSkip: 0, willFail: 1, needsReview: 0 },
      accounts: [{
        accountId: "a1",
        ownerEmail: "a1@example.com",
        predictedOutcome: "willFail",
        workflowOutcomes: [
          {
            workflowId: "first",
            workflowName: "First workflow",
            predictedOutcome: "willRun",
            issues: [],
            matchedTargetText: []
          },
          {
            workflowId: "second",
            workflowName: "Second workflow",
            predictedOutcome: "willFail",
            issues: [{
              severity: "blocking",
              category: "selector",
              message: "No visible match for Save"
            }],
            matchedTargetText: []
          }
        ]
      }]
    };

    const html = renderToStaticMarkup(createElement(PreflightPanel, {
      preflight,
      onRun: () => undefined
    }));

    expect(html).toContain("No visible match for Save");
    expect(html).not.toContain("No preflight issues");
  });
});
