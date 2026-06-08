import { describe, expect, it } from "vitest";
import { createBulkPreflightPlan } from "../src/server/services/preflightService.js";
import type { RecordedWorkflow } from "@zoom-automation/workflow-core";

function workflow(): RecordedWorkflow {
  return {
    version: 1,
    meta: {
      name: "Add Sydney numbers",
      description: "Fixture",
      category: "phone",
      recordedAt: new Date(0).toISOString(),
      recordedOnUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
      durationMs: 0
    },
    parameters: [],
    actions: [
      {
        id: "open-add",
        timestamp: 0,
        type: "click",
        selectors: { role: { role: "button", name: "Add Number" } },
        condition: {
          type: "entityStateGuard",
          operation: "assign",
          entityKind: "phoneNumber",
          match: { allText: ["Assigned +61 2 7000 0001"] },
          whenMatched: "skipAccount"
        },
        pageUrl: "https://zoom.us",
        pageTitle: "Zoom"
      },
      {
        id: "rows",
        timestamp: 0,
        type: "selectRows",
        selectors: {},
        rowSelection: { mode: "firstAvailable", count: 4, minimumCount: 4, entityKind: "phoneNumber", valuePattern: "\\+61[\\s().-]*2[\\d\\s().-]{6,}" },
        pageUrl: "https://zoom.us",
        pageTitle: "Zoom"
      }
    ],
    assertions: [],
    config: { startUrl: "https://zoom.us", requiresImpersonation: true, defaultTimeout: 10_000, retryableErrors: [] }
  };
}

describe("server bulk preflight service", () => {
  it("aggregates account predictions across selected workflows", () => {
    const result = createBulkPreflightPlan({
      workflows: [{ id: "wf", workflow: workflow() }],
      accounts: [
        { id: "skip", ownerEmail: "skip@example.com", name: "Skip" },
        { id: "run", ownerEmail: "run@example.com", name: "Run" }
      ],
      accountEvidence: {
        skip: { visibleText: "Assigned +61 2 7000 0001" },
        run: {
          visibleText: "+61 2 7000 0001 +61 2 7000 0002 +61 2 7000 0003 +61 2 7000 0004",
          selectorStates: { "open-add": { matchedCount: 1, visibleCount: 1 } }
        }
      }
    });

    expect(result.summary).toEqual({ willRun: 1, willSkip: 1, willFail: 0, needsReview: 0 });
    expect(result.accounts.map((account) => [account.accountId, account.predictedOutcome])).toEqual([
      ["skip", "willSkip"],
      ["run", "willRun"]
    ]);
  });

  it("does not convert missing page evidence into a false inventory failure", () => {
    const result = createBulkPreflightPlan({
      workflows: [{ id: "wf", workflow: workflow() }],
      accounts: [{ id: "unknown", ownerEmail: "unknown@example.com", name: "Unknown" }]
    });

    expect(result.summary).toEqual({ willRun: 0, willSkip: 0, willFail: 0, needsReview: 1 });
    expect(result.accounts[0].workflowOutcomes[0].issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      category: "inventory",
      message: expect.stringMatching(/Live page text evidence is required/)
    }));
  });
});
