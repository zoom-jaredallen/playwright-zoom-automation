import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFileWorkflowLifecycleStore,
  isLifecycleLiveRunnable
} from "../src/server/governance/workflowLifecycle.js";
import { evaluateRunReadiness } from "../src/server/services/runReadinessService.js";

function tempGovernancePath(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zoom-workflow-governance-"));
  return path.join(directory, "lifecycle.json");
}

describe("workflow lifecycle governance", () => {
  it("creates draft lifecycle records and promotes through validated, approved, and published", () => {
    const filePath = tempGovernancePath();
    try {
      const store = createFileWorkflowLifecycleStore(filePath);
      const draft = store.getOrCreate("recorded-flow", "recorded");
      expect(draft.status).toBe("draft");
      expect(isLifecycleLiveRunnable(draft.status)).toBe(false);

      const validated = store.transition("recorded-flow", "validated", { actor: "tester", note: "Replay passed" });
      const approved = store.transition("recorded-flow", "approved", { actor: "admin", note: "Approved for live use" });
      const published = store.transition("recorded-flow", "published", { actor: "admin" });

      expect(validated.status).toBe("validated");
      expect(approved.status).toBe("approved");
      expect(isLifecycleLiveRunnable(approved.status)).toBe(true);
      expect(published.history.map((entry) => entry.status)).toEqual(["draft", "validated", "approved", "published"]);

      const reloaded = createFileWorkflowLifecycleStore(filePath);
      expect(reloaded.get("recorded-flow")?.status).toBe("published");
    } finally {
      rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
  });

  it("blocks live readiness when selected workflows are still draft or validated", () => {
    const result = evaluateRunReadiness({
      selectedAccounts: [{ id: "a1", name: "Account" }],
      workflowIds: ["draft-flow", "published-flow"],
      enabledWorkflowIds: new Set(["draft-flow", "published-flow"]),
      addressProfile: "australia_sydney",
      dryRun: false,
      requiredDocuments: [],
      parameters: [],
      parameterValues: {},
      workflows: [
        { id: "draft-flow", name: "Draft flow", lifecycleStatus: "draft" },
        { id: "published-flow", name: "Published flow", lifecycleStatus: "published" }
      ]
    });

    expect(result.ready).toBe(false);
    expect(result.blocking.map((check) => check.id)).toContain("workflow-lifecycle");
    expect(result.blocking.find((check) => check.id === "workflow-lifecycle")?.message).toContain("Draft flow");
  });
});
