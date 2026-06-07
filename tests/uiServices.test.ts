import { describe, expect, it } from "vitest";
import { filterSelectableAccounts } from "../src/server/services/accountSelectionService.js";
import { createJobStore } from "../src/server/services/inMemoryJobStore.js";
import { createJobProgressAdapter } from "../src/server/services/jobRunner.js";
import { createWorkflowRegistry } from "../src/server/services/workflowRegistry.js";
import { canExpandRunAccount } from "../src/ui/components/RunStep.js";
import type { SubAccount } from "../src/automation/types.js";

describe("workflowRegistry", () => {
  it("exposes executable business-address workflows and future disabled workflows", () => {
    const registry = createWorkflowRegistry();

    // The registry exposes built-in workflows; it may also include recorded
    // workflows discovered on disk, so assert the built-ins are present rather
    // than an exact list.
    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "add-business-address",
        name: "Add business address",
        enabled: true
      }),
      expect.objectContaining({
        id: "check-business-address-status",
        name: "Check business address status",
        enabled: true
      }),
      expect.objectContaining({
        id: "account-settings-policies",
        name: "Change account settings policies",
        enabled: false
      }),
      expect.objectContaining({
        id: "10dlc-brand-campaign",
        name: "Add 10DLC campaign and brand",
        enabled: false
      })
    ]));
    expect(registry.getEnabled("add-business-address").id).toBe("add-business-address");
    expect(registry.getEnabled("check-business-address-status").id).toBe("check-business-address-status");
    expect(() => registry.getEnabled("10dlc-brand-campaign")).toThrow(/not enabled/);
  });
});

describe("filterSelectableAccounts", () => {
  const accounts: SubAccount[] = [
    account("a300", "michael.chen@lab494-s300.zoomdemos.com"),
    account("a301", "michael.chen@lab494-s301.zoomdemos.com"),
    account("a325", "michael.chen@lab494-s325.zoomdemos.com"),
    account("a350", "michael.chen@lab494-s350.zoomdemos.com"),
    account("a351", "michael.chen@lab494-s351.zoomdemos.com")
  ];

  it("combines owner range and search filters for sub-account selection", () => {
    const result = filterSelectableAccounts(accounts, {
      ownerRange: {
        from: "michael.chen@lab494-s301.zoomdemos.com",
        to: "michael.chen@lab494-s350.zoomdemos.com"
      },
      search: "s32"
    });

    expect(result.map((item) => item.id)).toEqual(["a325"]);
  });

  it("limits the returned accounts after filtering", () => {
    const result = filterSelectableAccounts(accounts, { limit: 2 });

    expect(result.map((item) => item.id)).toEqual(["a300", "a301"]);
  });
});

describe("inMemoryJobStore", () => {
  it("tracks job and per-account workflow status transitions", () => {
    const store = createJobStore();
    const job = store.createJob({
      accountIds: ["a301", "a302"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });

    store.markAccount(job.id, "a301", {
      status: "running",
      workflowId: "add-business-address"
    });
    store.markAccount(job.id, "a301", {
      status: "completed",
      workflowId: "add-business-address"
    });

    const snapshot = store.getJob(job.id);
    expect(snapshot?.summary).toEqual({ queued: 1, running: 0, completed: 1, skipped: 0, failed: 0 });
    expect(snapshot?.accounts[0]).toEqual(
      expect.objectContaining({
        accountId: "a301",
        status: "completed",
        workflowId: "add-business-address"
      })
    );
  });

  it("keeps a failed account failed when a later pipeline workflow starts", async () => {
    const store = createJobStore();
    const job = store.createJob({
      accountIds: ["a301"],
      workflowIds: ["first-workflow", "second-workflow"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });
    const subAccount = account("a301", "michael.chen@lab494-s301.zoomdemos.com");

    const firstWorkflow = createJobProgressAdapter(store, job.id, "first-workflow");
    await firstWorkflow.markRunning(subAccount);
    await firstWorkflow.markFailed(subAccount, new Error("first workflow failed"), false);

    const secondWorkflow = createJobProgressAdapter(store, job.id, "second-workflow");
    await expect(secondWorkflow.shouldSkip(subAccount)).resolves.toBe(true);

    const snapshot = store.getJob(job.id);
    expect(snapshot?.summary).toEqual({ queued: 0, running: 0, completed: 0, skipped: 0, failed: 1 });
    expect(snapshot?.accounts[0]).toEqual(
      expect.objectContaining({
        accountId: "a301",
        status: "failed",
        workflowId: "first-workflow",
        error: "first workflow failed"
      })
    );
    expect(snapshot?.accounts[0].logs?.at(-1)).toEqual(
      expect.objectContaining({
        step: "Skipping workflow",
        detail: "Previous workflow failed"
      })
    );
  });
});

describe("canExpandRunAccount", () => {
  it("allows finished account rows to expand even when no step logs exist yet", () => {
    expect(canExpandRunAccount({ status: "failed" })).toBe(true);
    expect(canExpandRunAccount({ status: "completed" })).toBe(true);
    expect(canExpandRunAccount({ status: "skipped" })).toBe(true);
  });

  it("keeps queued rows collapsed unless logs exist", () => {
    expect(canExpandRunAccount({ status: "queued" })).toBe(false);
    expect(canExpandRunAccount({ status: "queued", logs: [{ timestamp: new Date().toISOString(), step: "Queued" }] })).toBe(true);
  });
});

function account(id: string, ownerEmail: string): SubAccount {
  return { id, name: "Zoom Demos", ownerEmail };
}
