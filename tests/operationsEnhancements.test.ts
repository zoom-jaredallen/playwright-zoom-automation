import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createAccountCohortStore } from "../src/server/services/accountCohortStore.js";
import { createJobStore, type JobStore } from "../src/server/services/inMemoryJobStore.js";
import { createRetryJobInput, selectRetryAccounts } from "../src/server/services/jobRetryService.js";
import { evaluateRunReadiness } from "../src/server/services/runReadinessService.js";
import {
  appendStructuredAccountLog,
  deriveAccountTimeline
} from "../src/server/services/runTimelineService.js";
import {
  buildWorkflowParameterDefaults,
  validateWorkflowParameterValues
} from "../src/server/services/workflowParameterService.js";
import type { SubAccount } from "../src/automation/types.js";
import type { RecordedWorkflow } from "@zoom-automation/workflow-core";

const cohortsDir = path.resolve("output/test-cohorts");

beforeEach(() => {
  rmSync(cohortsDir, { recursive: true, force: true });
  mkdirSync(cohortsDir, { recursive: true });
});

describe("run readiness service", () => {
  it("blocks a run when accounts, workflows, and required parameters are missing", () => {
    const result = evaluateRunReadiness({
      selectedAccounts: [],
      workflowIds: [],
      enabledWorkflowIds: new Set(["add-business-address"]),
      addressProfile: undefined,
      dryRun: true,
      requiredDocuments: [{ label: "Business registration", path: undefined, required: true }],
      parameters: [{ name: "contact.email", required: true }],
      parameterValues: {}
    });

    expect(result.ready).toBe(false);
    expect(result.blocking.map((check) => check.id)).toEqual([
      "accounts",
      "workflows",
      "address-profile",
      "documents",
      "parameters"
    ]);
  });

  it("warns but allows a live run after explicit live mode is selected", () => {
    const result = evaluateRunReadiness({
      selectedAccounts: [account("a1")],
      workflowIds: ["add-business-address"],
      enabledWorkflowIds: new Set(["add-business-address"]),
      addressProfile: "australia_sydney",
      dryRun: false,
      requiredDocuments: [],
      parameters: [],
      parameterValues: {}
    });

    expect(result.ready).toBe(true);
    expect(result.warnings.map((check) => check.id)).toEqual(["live-mode"]);
  });
});

describe("job retry service", () => {
  it("selects failed accounts and preserves source job input for a retry", () => {
    const store = seedJobStore();
    const source = store.listJobs()[0];

    const retryAccountIds = selectRetryAccounts(source, { statuses: ["failed"] });
    const retryInput = createRetryJobInput(source, retryAccountIds);

    expect(retryAccountIds).toEqual(["a2"]);
    expect(retryInput).toEqual({
      accountIds: ["a2"],
      workflowIds: ["add-business-address", "check-business-address-status"],
      dryRun: true,
      addressProfile: "australia_sydney",
      sourceJobId: source.id,
      retryOfAccountIds: ["a2"]
    });
  });
});

describe("account cohort store", () => {
  it("creates, lists, updates, and deletes account cohorts", () => {
    const store = createAccountCohortStore(cohortsDir);

    const cohort = store.create({
      name: "AU retry batch",
      accountIds: ["a1", "a2"],
      filters: { search: "lab494" }
    });

    expect(store.list()).toHaveLength(1);
    expect(store.get(cohort.id)?.accountIds).toEqual(["a1", "a2"]);
    expect(store.update(cohort.id, { accountIds: ["a3"] }).accountIds).toEqual(["a3"]);
    expect(store.delete(cohort.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});

describe("run timeline service", () => {
  it("derives current, last successful, and failed step status from structured logs", () => {
    const store = createJobStore();
    const job = store.createJob({
      accountIds: ["a1"],
      workflowIds: ["add-business-address"],
      dryRun: true,
      addressProfile: "australia_sydney"
    });

    appendStructuredAccountLog(store, job.id, "a1", {
      level: "info",
      workflowId: "add-business-address",
      stepId: "navigate",
      stepName: "Open page",
      message: "Opening page"
    });
    appendStructuredAccountLog(store, job.id, "a1", {
      level: "success",
      workflowId: "add-business-address",
      stepId: "fill",
      stepName: "Fill company",
      message: "Company filled"
    });
    appendStructuredAccountLog(store, job.id, "a1", {
      level: "error",
      workflowId: "add-business-address",
      stepId: "save",
      stepName: "Save",
      message: "Save failed",
      artifactRefs: [{ type: "screenshot", url: "/artifacts/fail.png" }]
    });

    const timeline = deriveAccountTimeline(store.getJob(job.id)!.accounts[0]);
    expect(timeline.currentStep?.stepName).toBe("Save");
    expect(timeline.lastSuccessfulStep?.stepName).toBe("Fill company");
    expect(timeline.failedStep?.artifactRefs?.[0].url).toBe("/artifacts/fail.png");
  });
});

describe("workflow parameter service", () => {
  it("builds defaults and validates required workflow parameters", () => {
    const workflow: RecordedWorkflow = {
      version: 1,
      meta: {
        name: "Parameterized workflow",
        description: "Fixture",
        category: "custom",
        recordedAt: new Date(0).toISOString(),
        recordedOnUrl: "https://zoom.us",
        durationMs: 0
      },
      actions: [],
      parameters: [
        { name: "contact.email", type: "string", required: true, description: "Contact email", source: "prompt" },
        { name: "country", type: "select", required: false, description: "Country", source: "prompt", options: ["Australia"], defaultValue: "Australia" }
      ],
      assertions: [],
      config: { startUrl: "https://zoom.us", requiresImpersonation: true, defaultTimeout: 10_000, retryableErrors: [] }
    };

    expect(buildWorkflowParameterDefaults(workflow)).toEqual({ country: "Australia" });
    expect(validateWorkflowParameterValues(workflow, { country: "Australia" })).toEqual({
      valid: false,
      errors: [{ name: "contact.email", message: "contact.email is required" }]
    });
    expect(validateWorkflowParameterValues(workflow, { "contact.email": "admin@example.com", country: "US" }).errors[0]?.message)
      .toBe("country must be one of: Australia");
  });
});

function seedJobStore(): JobStore {
  const store = createJobStore();
  const job = store.createJob({
    accountIds: ["a1", "a2", "a3"],
    workflowIds: ["add-business-address", "check-business-address-status"],
    dryRun: true,
    addressProfile: "australia_sydney"
  });
  store.markAccount(job.id, "a1", { status: "completed", workflowId: "add-business-address" });
  store.markAccount(job.id, "a2", { status: "failed", workflowId: "add-business-address", error: "selector failed" });
  store.markAccount(job.id, "a3", { status: "skipped", workflowId: "add-business-address", message: "already exists" });
  return store;
}

function account(id: string): SubAccount {
  return { id, name: `Account ${id}`, ownerEmail: `${id}@example.com` };
}
