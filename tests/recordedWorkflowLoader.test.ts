import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { compileWorkflow } from "../src/compiler/compiler.js";
import type { RecordedWorkflow } from "../src/compiler/types.js";
import {
  createRecordedFlowLazy,
  getRecordedDefinition,
  listRecordedDefinitions,
  recordedWorkflowExists
} from "../src/server/services/recordedWorkflowLoader.js";
import { createWorkflowRegistry } from "../src/server/services/workflowRegistry.js";

const RECORDED_BASE = path.resolve("src/workflows/recorded");
const FIXTURE_ID = "test-recorded-fixture";

function fixture(): RecordedWorkflow {
  return {
    version: 1,
    meta: {
      name: "Test Recorded Fixture",
      description: "fixture",
      recordedAt: "2026-06-04T00:00:00Z",
      recordedOnUrl: "https://zoom.us/x",
      durationMs: 1,
      category: "custom"
    },
    parameters: [],
    actions: [
      { id: "a1", timestamp: 1, type: "click", selectors: { role: { role: "button", name: "Save" } }, pageUrl: "u", pageTitle: "t" }
    ],
    assertions: [],
    config: { startUrl: "/x", requiresImpersonation: true, defaultTimeout: 10000, retryableErrors: [] }
  };
}

beforeAll(() => {
  compileWorkflow(fixture(), RECORDED_BASE, FIXTURE_ID);
});

afterAll(() => {
  rmSync(path.join(RECORDED_BASE, FIXTURE_ID), { recursive: true, force: true });
});

describe("recordedWorkflowLoader", () => {
  it("lists a compiled recorded workflow as an enabled definition", () => {
    const definitions = listRecordedDefinitions();
    const found = definitions.find((d) => d.id === FIXTURE_ID);
    expect(found).toBeDefined();
    expect(found?.enabled).toBe(true);
    expect(found?.name).toBe("Test Recorded Fixture");
    expect(found?.category).toBe("custom");
  });

  it("reports existence and a definition lookup", () => {
    expect(recordedWorkflowExists(FIXTURE_ID)).toBe(true);
    expect(recordedWorkflowExists("does-not-exist")).toBe(false);
    expect(getRecordedDefinition(FIXTURE_ID)?.id).toBe(FIXTURE_ID);
  });

  it("rejects path traversal in the id", () => {
    expect(recordedWorkflowExists("../../package")).toBe(false);
  });

  it("returns a lazy AutomationFlow without importing eagerly", () => {
    const flow = createRecordedFlowLazy(FIXTURE_ID, {} as never);
    expect(flow.name).toBe(FIXTURE_ID);
    expect(typeof flow.run).toBe("function");
  });
});

describe("createWorkflowRegistry — composed", () => {
  it("includes recorded workflows alongside built-ins", () => {
    const registry = createWorkflowRegistry();
    const ids = registry.list().map((d) => d.id);
    expect(ids).toContain("add-business-address"); // built-in
    expect(ids).toContain(FIXTURE_ID); // recorded
  });

  it("resolves a recorded workflow via getEnabled and createFlow", () => {
    const registry = createWorkflowRegistry();
    expect(registry.getEnabled(FIXTURE_ID).id).toBe(FIXTURE_ID);
    const flow = registry.createFlow(FIXTURE_ID, {} as never);
    expect(flow.name).toBe(FIXTURE_ID);
  });

  it("throws for an unknown workflow id", () => {
    const registry = createWorkflowRegistry();
    expect(() => registry.getEnabled("nope-not-here")).toThrow();
  });
});
