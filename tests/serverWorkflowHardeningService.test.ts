import { describe, expect, it } from "vitest";
import { applyAutomaticWorkflowHardening } from "../src/server/services/workflowHardeningService.js";
import type { RecordedWorkflow } from "@zoom-automation/workflow-core";

function workflow(): RecordedWorkflow {
  return {
    version: 1,
    meta: {
      name: "Create Queue",
      description: "raw import",
      recordedAt: "2026-06-08T00:00:00.000Z",
      recordedOnUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
      durationMs: 1000,
      category: "custom"
    },
    parameters: [],
    actions: [
      {
        id: "create",
        timestamp: 1,
        type: "click",
        selectors: { role: { role: "button", name: "Create Queue" } },
        pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
        pageTitle: "Queues"
      },
      {
        id: "name",
        timestamp: 2,
        type: "fill",
        selectors: { label: "Queue Name" },
        value: "Priority Support",
        pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new",
        pageTitle: "Queues"
      },
      {
        id: "extension",
        timestamp: 3,
        type: "fill",
        selectors: { label: "Extension" },
        value: "5001",
        pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new",
        pageTitle: "Queues"
      },
      {
        id: "save",
        timestamp: 4,
        type: "click",
        selectors: { role: { role: "button", name: "Save" } },
        retryCount: 3,
        networkWaitUrl: "/api/queues",
        pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues/new",
        pageTitle: "Queues"
      }
    ],
    assertions: [],
    config: {
      startUrl: "/cpw/page/contactCenter#/queues",
      requiresImpersonation: true,
      defaultTimeout: 10_000,
      retryableErrors: []
    }
  };
}

describe("server workflow hardening service", () => {
  it("hardens imported workflows before compilation without mutating the source", () => {
    const source = workflow();
    const hardened = applyAutomaticWorkflowHardening(source);

    expect(source.actions.find((action) => action.id === "create")?.condition).toBeUndefined();
    expect(hardened.actions.find((action) => action.id === "create")?.condition?.type).toBe("entityStateGuard");
    expect(hardened.actions.find((action) => action.id === "save")?.retryCount).toBe(0);
    expect(hardened.assertions).toContainEqual(expect.objectContaining({
      afterAction: "save",
      type: "entityExists",
      expected: "Priority Support|5001"
    }));
    expect(hardened.hardening?.bulkReady).toBe(true);
    expect(hardened.quality?.assertionCoverage).toBeGreaterThanOrEqual(100);
  });
});
