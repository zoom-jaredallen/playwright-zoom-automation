import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileWorkflow } from "../src/compiler/compiler.js";
import type { RecordedWorkflow } from "../src/compiler/types.js";

const testOutputDir = path.resolve("output/test-compiled-workflows");

beforeEach(() => {
  rmSync(testOutputDir, { recursive: true, force: true });
  mkdirSync(testOutputDir, { recursive: true });
});

function createTestWorkflow(overrides?: Partial<RecordedWorkflow>): RecordedWorkflow {
  return {
    version: 1,
    meta: {
      name: "Add AU Toll Address",
      description: "Test workflow",
      recordedAt: "2026-06-03T00:00:00Z",
      recordedOnUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
      durationMs: 30000,
      category: "phone"
    },
    parameters: [
      { name: "address.line1", type: "string", required: true, description: "Street address", source: "addressProfile" },
      { name: "address.country", type: "string", required: true, description: "Country", source: "addressProfile" }
    ],
    actions: [
      {
        id: "act_1",
        timestamp: 1000,
        type: "navigate",
        selectors: {},
        url: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        pageTitle: "Business Address",
        description: "Navigate to business address page"
      },
      {
        id: "act_2",
        timestamp: 2000,
        type: "click",
        selectors: { role: { role: "button", name: "Add Address" }, text: "Add Address" },
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        pageTitle: "Business Address",
        description: "Click Add Address button"
      },
      {
        id: "act_3",
        timestamp: 3000,
        type: "fill",
        selectors: { label: "Address Line 1", role: { role: "textbox", name: "Address Line 1" } },
        value: "{{address.line1}}",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        pageTitle: "Business Address",
        description: "Fill address line 1"
      },
      {
        id: "act_4",
        timestamp: 5000,
        type: "click",
        selectors: { role: { role: "button", name: "Save" }, text: "Save" },
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        pageTitle: "Business Address",
        description: "Click Save"
      }
    ],
    assertions: [
      {
        afterAction: "act_4",
        type: "textVisible",
        expected: "success|saved|added",
        timeout: 10000,
        onFailure: "screenshot"
      }
    ],
    config: {
      startUrl: "/cpw/page/phoneNumbers#/business-address",
      requiresImpersonation: true,
      defaultTimeout: 10000,
      retryableErrors: ["timeout", "net::"]
    },
    ...overrides
  };
}

describe("compileWorkflow", () => {
  it("generates all expected output files", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);

    expect(result.id).toBe("add-au-toll-address");
    expect(existsSync(path.join(result.outputDir, "index.ts"))).toBe(true);
    expect(existsSync(path.join(result.outputDir, "flow.ts"))).toBe(true);
    expect(existsSync(path.join(result.outputDir, "test.ts"))).toBe(true);
    expect(existsSync(path.join(result.outputDir, "schema.json"))).toBe(true);
  });

  it("generates a valid plugin index file", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const indexContent = readFileSync(path.join(result.outputDir, "index.ts"), "utf8");

    expect(indexContent).toContain('id: "add-au-toll-address"');
    expect(indexContent).toContain('name: "Add AU Toll Address"');
    expect(indexContent).toContain("enabled: true");
    expect(indexContent).toContain('category: "phone"');
    expect(indexContent).toContain("createFlow(context)");
  });

  it("generates flow code with parameterized values", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flowContent = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flowContent).toContain("impersonateSubAccount");
    expect(flowContent).toContain("dismissBlockingZoomPopups");
    expect(flowContent).toContain("resolveValue");
    expect(flowContent).toContain("{{address.line1}}");
    expect(flowContent).toContain("clickElement");
  });

  it("generates test file with correct counts", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const testContent = readFileSync(path.join(result.outputDir, "test.ts"), "utf8");

    expect(testContent).toContain("2 parameter(s)");
    expect(testContent).toContain("1 assertion(s)");
    expect(testContent).toContain("4 recorded action(s)");
  });

  it("reports test results correctly", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);

    expect(result.testResults.parameterCheck).toBe("passed");
    expect(result.testResults.selectorCheck).toBe("passed");
    // "Add Address" and "Save" both match the submit pattern; only "Save" has an assertion
    expect(result.testResults.assertionCoverage).toBe("50%");
  });

  it("warns about CSS-only selectors", () => {
    const workflow = createTestWorkflow({
      actions: [
        ...createTestWorkflow().actions,
        {
          id: "act_5",
          timestamp: 6000,
          type: "click",
          selectors: { css: ".some-unstable-class > button" },
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Click unstable element"
        }
      ]
    });
    const result = compileWorkflow(workflow, testOutputDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("CSS selector");
    expect(result.testResults.selectorCheck).toBe("failed");
  });

  it("honors an explicit id override (used by duplicate)", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir, "add-au-toll-address-2");
    expect(result.id).toBe("add-au-toll-address-2");
    expect(result.outputDir).toBe(path.join(testOutputDir, "add-au-toll-address-2"));
    expect(existsSync(path.join(result.outputDir, "schema.json"))).toBe(true);
  });

  it("emits a default export on the flow class so it can be dynamically imported", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flowContent = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    expect(flowContent).toContain("export default AddAuTollAddressFlow;");
  });

  it("preserves the original schema.json", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const schema = JSON.parse(readFileSync(path.join(result.outputDir, "schema.json"), "utf8"));

    expect(schema.version).toBe(1);
    expect(schema.meta.name).toBe("Add AU Toll Address");
    expect(schema.actions).toHaveLength(4);
    expect(schema.parameters).toHaveLength(2);
  });
});
