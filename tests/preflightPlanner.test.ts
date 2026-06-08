import { describe, expect, it } from "vitest";
import {
  buildPreflightPlan,
  type PreflightAccountInput,
  type RecordedAction
} from "@zoom-automation/workflow-core";

function action(id: string, overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "click",
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
    pageTitle: "Zoom Admin",
    ...overrides
  };
}

describe("bulk preflight planner", () => {
  it("predicts skips, runs, failures, and review states without executing mutations", () => {
    const actions: RecordedAction[] = [
        action("open-add-number", {
          selectors: { role: { role: "button", name: "Add Number" } },
          description: "Expand Add Number",
          ariaState: { expanded: true },
          condition: {
            type: "entityStateGuard",
            operation: "assign",
            entityKind: "phoneNumber",
            match: { allText: ["Assigned +61 2 7000 0001"] },
            whenMatched: "skipAccount"
          }
        }),
        action("city", {
          type: "fill",
          selectors: { label: "City" },
          value: "Sydney"
        }),
        action("select-rows", {
          type: "selectRows",
          selectors: {},
          rowSelection: {
            mode: "firstAvailable",
            count: 4,
            minimumCount: 4,
            entityKind: "phoneNumber",
            valuePattern: "\\+61[\\s().-]*2[\\d\\s().-]{6,}"
          }
        }),
        action("done", {
          selectors: { role: { role: "button", name: "Done" } },
          networkWaitUrl: "/cp/webapi/phone-number/assign"
        })
      ];

    const accounts: PreflightAccountInput[] = [
      { accountId: "already", ownerEmail: "already@example.com", visibleText: "Assigned +61 2 7000 0001" },
      {
        accountId: "ready",
        ownerEmail: "ready@example.com",
        visibleText: "Available +61 2 7000 0001 Available +61 2 7000 0002 Available +61 2 7000 0003 Available +61 2 7000 0004",
        selectorStates: { "open-add-number": { matchedCount: 1, visibleCount: 1 }, city: { matchedCount: 1, visibleCount: 1 }, done: { matchedCount: 1, visibleCount: 1 } }
      },
      { accountId: "broken", ownerEmail: "broken@example.com", visibleText: "", selectorStates: { "open-add-number": { matchedCount: 0, visibleCount: 0 } } },
      {
        accountId: "review",
        ownerEmail: "review@example.com",
        visibleText: "Available +61 2 7000 0001 Available +61 2 7000 0002 Available +61 2 7000 0003 Available +61 2 7000 0004",
        selectorStates: { "open-add-number": { matchedCount: 1, visibleCount: 1 }, city: { matchedCount: 1, visibleCount: 1 }, done: { matchedCount: 1, visibleCount: 1 } },
        reviewReasons: ["Upload step requires manual evidence review"]
      }
    ];

    const result = buildPreflightPlan({
      workflowId: "add-phone-numbers",
      workflowName: "Add phone numbers",
      actions,
      assertions: [],
      accounts
    });

    expect(result.summary).toEqual({ willRun: 1, willSkip: 1, willFail: 1, needsReview: 1 });
    expect(result.accounts.find((account) => account.accountId === "already")?.predictedOutcome).toBe("willSkip");
    expect(result.accounts.find((account) => account.accountId === "ready")?.predictedOutcome).toBe("willRun");
    expect(result.accounts.find((account) => account.accountId === "broken")?.predictedOutcome).toBe("willFail");
    expect(result.accounts.find((account) => account.accountId === "review")?.predictedOutcome).toBe("needsReview");
  });

  it("requires every allText token before predicting an idempotent skip", () => {
    const actions: RecordedAction[] = [
      action("open-add-number", {
        condition: {
          type: "entityStateGuard",
          operation: "assign",
          entityKind: "phoneNumber",
          match: { allText: ["Assigned +61 2 7000 0001", "Sydney"] },
          whenMatched: "skipAccount"
        }
      })
    ];

    const result = buildPreflightPlan({
      workflowId: "add-phone-numbers",
      workflowName: "Add phone numbers",
      actions,
      assertions: [],
      accounts: [
        { accountId: "partial", visibleText: "Assigned +61 2 7000 0001" },
        { accountId: "complete", visibleText: "Assigned +61 2 7000 0001 Sydney" }
      ]
    });

    expect(result.accounts.find((account) => account.accountId === "partial")?.predictedOutcome).toBe("willRun");
    expect(result.accounts.find((account) => account.accountId === "complete")?.predictedOutcome).toBe("willSkip");
  });

  it("marks row-selection inventory checks as needs review when page evidence is missing", () => {
    const result = buildPreflightPlan({
      workflowId: "add-phone-numbers",
      workflowName: "Add phone numbers",
      actions: [
        action("select-rows", {
          type: "selectRows",
          selectors: {},
          rowSelection: {
            mode: "firstAvailable",
            count: 4,
            minimumCount: 4,
            entityKind: "phoneNumber",
            valuePattern: "\\+61[\\s().-]*2[\\d\\s().-]{6,}"
          }
        })
      ],
      assertions: [],
      accounts: [{ accountId: "unknown", visibleText: "" }]
    });

    const account = result.accounts[0];
    expect(account.predictedOutcome).toBe("needsReview");
    expect(account.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      category: "inventory",
      message: expect.stringMatching(/Live page text evidence is required/)
    }));
  });
});
