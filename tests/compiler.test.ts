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
    expect(flowContent).toContain('from "../../../zoom/impersonation.js"');
    expect(flowContent).toContain('from "../../../zoom/popups.js"');
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

  it("keeps the requested id when a workflow is saved with a renamed display name", () => {
    const workflow = createTestWorkflow({
      meta: {
        ...createTestWorkflow().meta,
        name: "Renamed in editor"
      }
    });
    const result = compileWorkflow(workflow, testOutputDir, "original-recorded-id");

    expect(result.id).toBe("original-recorded-id");
    expect(result.outputDir).toBe(path.join(testOutputDir, "original-recorded-id"));
    expect(existsSync(path.join(result.outputDir, "flow.ts"))).toBe(true);
    expect(existsSync(path.join(testOutputDir, "renamed-in-editor"))).toBe(false);
  });

  it("falls back to a generated id when the workflow name slug is empty", () => {
    const workflow = createTestWorkflow({
      meta: {
        ...createTestWorkflow().meta,
        name: "!!!"
      }
    });
    const result = compileWorkflow(workflow, testOutputDir);

    expect(result.id).toMatch(/^recorded-\d+$/);
    expect(result.outputDir).not.toBe(testOutputDir);
    expect(existsSync(path.join(result.outputDir, "schema.json"))).toBe(true);
  });

  it("emits a default export on the flow class so it can be dynamically imported", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flowContent = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    expect(flowContent).toContain("export default AddAuTollAddressFlow;");
  });

  it("generates anchor scoping, ARIA-state options, guards, and IF/ELSE blocks", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "if1", timestamp: 1, type: "if", selectors: {}, pageUrl: "u", pageTitle: "t",
          ifCondition: { kind: "or", operands: [{ kind: "textVisible", text: "Pending" }, { kind: "urlContains", text: "#/x" }] },
          thenActions: [
            {
              id: "c1", timestamp: 2, type: "click", pageUrl: "u", pageTitle: "t",
              selectors: { role: { role: "checkbox", name: "Enable", checked: false }, anchor: { text: "michael.chen", scopeRole: "row" } }
            }
          ],
          elseActions: [
            { id: "c2", timestamp: 3, type: "click", pageUrl: "u", pageTitle: "t", selectors: { role: { role: "button", name: "Cancel" } }, guard: { kind: "urlContains", text: "#/y" }, guardElse: "skip" }
          ]
        }
      ]
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    expect(flow).toContain("if (await this.evalPredicate(page,");   // IF block
    expect(flow).toContain("} else {");                             // ELSE branch
    expect(flow).toContain('.filter({ hasText');                    // anchor scoping
    expect(flow).toContain("opts.checked");                         // ARIA-state option wiring
    expect(flow).toContain("guardOk");                              // step guard
  });

  it("skips mutating (submit) steps under dry run and resolves per-account values", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    // Save click is auto-marked mutating -> guarded by dryRun
    expect(flow).toContain("this.options.config.runtime.dryRun");
    expect(flow).toContain("dryRunSkipped = true");
    expect(flow).toContain('{ status: "skipped", message: "Dry run');
    // Per-account values consulted before the address profile
    expect(flow).toContain("config.accountValues");
    expect(flow).toContain("const activeAccountId = input.account.id");
    expect(flow).toContain("config.accountValues?.[activeAccountId]?.[paramName]");
    expect(flow).toContain("this.resolveValue(\"{{address.line1}}\", activeAccountId)");
    expect(flow).not.toContain("this.activeAccountId");
  });

  it("keeps assertions for dry-run-skipped steps inside the executed branch", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    const saveStep = flow.slice(flow.indexOf("// Step 4: Click Save"), flow.indexOf("await context.tracing.stop"));

    expect(saveStep).toContain("Dry run: skipping mutating step");
    expect(saveStep).not.toContain("}\n      // Auto verification");
  });

  it("does not treat opener add-user clicks as dry-run mutations", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "act_1",
          timestamp: 1000,
          type: "click",
          selectors: { role: { role: "button", name: "Add user" }, text: "Add user" },
          pageUrl: "https://zoom.us/cci/index/admin#/admin-agents",
          pageTitle: "Admin users",
          description: "Click Add user"
        }
      ],
      assertions: []
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("Click Add user");
    expect(flow).not.toContain("Dry run: skipping mutating step");
  });

  it("compiles after-action assertions so a failed submit is detected", () => {
    // createTestWorkflow has an assertion afterAction act_4 (the Save click).
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");
    expect(flow).toContain("Auto verification");
    expect(flow).toContain("getByText(new RegExp(");
  });

  it("waits for page readiness after generated recorded steps", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("private async waitForPageReady");
    expect(flow).toContain("await this.waitForPageReady(page, policy.readyTimeoutMs ?? 10_000)");
    expect(flow).toContain('"readyTimeoutMs":10000');
    expect(flow).toContain("[class*='spinner']");
  });

  it("uses recorded selectors for element-visible assertion steps", () => {
    const workflow = createTestWorkflow({
      actions: [
        ...createTestWorkflow().actions,
        {
          id: "act_5",
          timestamp: 6000,
          type: "assert",
          selectors: { role: { role: "link", name: "Michael Chen" }, text: "Michael Chen" },
          assertionType: "elementVisible",
          expected: "Michael Chen",
          pageUrl: "https://zoom.us/cci/index/admin#/admin-agents",
          pageTitle: "Users",
          description: "Assert Michael Chen exists"
        }
      ]
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain('const element = await this.findElement(page, {"role":{"role":"link","name":"Michael Chen"},"text":"Michael Chen"}, [], 10000);');
    expect(flow).not.toContain('page.locator("Michael Chen").first().waitFor');
  });

  it("generates candidate-aware element calls", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "act_candidate",
          timestamp: 1000,
          type: "click",
          selectors: { css: ".weak" },
          selectorCandidates: [
            {
              id: "role-save",
              kind: "role",
              selector: { role: { role: "button", name: "Save" } },
              source: "recorded",
              diagnostics: { matchedCount: 1, visibleCount: 1 }
            }
          ],
          selectedCandidateId: "role-save",
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Click Save"
        }
      ],
      assertions: []
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain('from "../../../runtime/selectors/selectorResolver.js"');
    expect(flow).toContain('await this.clickElement(page, {"css":".weak"}, [{"id":"role-save"');
    expect(flow).toContain("await resolveSelector");
    expect(flow).toContain("selectorDiagnostics");
  });

  it("generates dedicated select replay with select metadata", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "act_select",
          timestamp: 1000,
          type: "select",
          selectors: { role: { role: "combobox", name: "Country" } },
          selectorCandidates: [
            { id: "role-country", kind: "role", selector: { role: { role: "combobox", name: "Country" } }, source: "recorded" }
          ],
          selectMetadata: {
            optionLabel: "Australia",
            optionCandidates: [
              { id: "option-au", kind: "role", selector: { role: { role: "option", name: "Australia" } }, source: "recorded" }
            ],
            popupSelectorHint: { role: { role: "listbox" } },
            verificationText: "Australia"
          },
          value: "Australia",
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Select country"
        }
      ],
      assertions: []
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("await this.selectOption(page");
    expect(flow).toContain('"optionLabel":"Australia"');
    expect(flow).toContain("private async findOpenSelectPopup");
    expect(flow).toContain("selectOption({ label: value }");
  });

  it("generates relationship-aware anchor scope resolution", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "anchored",
          timestamp: 1000,
          type: "click",
          selectors: {
            role: { role: "button", name: "Save" },
            anchor: {
              text: "Add user",
              scopeRole: "dialog",
              scopeSelector: "[role='dialog'], dialog",
              relationship: "near"
            }
          },
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Click dialog save"
        }
      ],
      assertions: []
    });
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("private resolveAnchorScope");
    expect(flow).toContain("anchor.scopeSelector");
    expect(flow).toContain('"relationship":"near"');
  });

  it("writes selector diagnostics artifacts on generated flow failure", () => {
    const workflow = createTestWorkflow();
    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain('import { mkdir, writeFile } from "node:fs/promises";');
    expect(flow).toContain("private async writeSelectorDiagnostics");
    expect(flow).toContain("selector-diagnostics.json");
    expect(flow).toContain("await this.writeSelectorDiagnostics(artifactBase, error)");
  });

  it("compiles first-class assertion types for reliable replay checks", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "assert-status",
          timestamp: 1000,
          type: "assert",
          selectors: {},
          assertionType: "addressStatusEquals",
          expected: "Verified",
          timeout: 10000,
          onFailure: "screenshot",
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Verify address status"
        },
        {
          id: "assert-url",
          timestamp: 1001,
          type: "assert",
          selectors: {},
          assertionType: "urlMatches",
          expected: "#/business-address$",
          timeout: 10000,
          onFailure: "fail",
          pageUrl: "https://zoom.us/test",
          pageTitle: "Test",
          description: "Verify URL pattern"
        }
      ],
      assertions: [
        {
          afterAction: "assert-url",
          type: "toastVisible",
          expected: "Saved",
          timeout: 10000,
          onFailure: "screenshot"
        }
      ]
    });

    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain('page.locator("tr, [role=\'row\']", { hasText: "Verified" })');
    expect(flow).toContain("new RegExp(\"#/business-address$\")");
    expect(flow).toContain("[role='status'], [role='alert'], .toast");
    expect(flow).toContain("Auto verification (toastVisible)");
  });

  it("compiles generic entity guards and entity assertions", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "open-create",
          timestamp: 1000,
          type: "click",
          selectors: { role: { role: "button", name: "Create Queue" } },
          condition: {
            type: "entityStateGuard",
            operation: "create",
            entityKind: "queue",
            match: { allText: ["Priority Support", "5001"] },
            whenMatched: "skipAccount"
          },
          pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
          pageTitle: "Queues",
          description: "Click Create Queue"
        },
        {
          id: "save",
          timestamp: 1001,
          type: "click",
          selectors: { role: { role: "button", name: "Save" } },
          retryCount: 0,
          sideEffectRisk: "mutation",
          pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
          pageTitle: "Queues",
          description: "Click Save"
        }
      ],
      assertions: [
        {
          afterAction: "save",
          type: "entityExists",
          expected: "Priority Support|5001",
          timeout: 15000,
          onFailure: "screenshot"
        }
      ]
    });

    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("entityStateGuard");
    expect(flow).toContain("entityStateGuardMatched");
    expect(flow).toContain("Auto verification (entityExists)");
    expect(flow).toContain("await this.expectEntityPresence(page, \"Priority Support|5001\", true, 15000);");
  });

  it("compiles dynamic first-available row selection for phone-number allocation", () => {
    const workflow = createTestWorkflow({
      actions: [
        {
          id: "select-rows",
          timestamp: 1000,
          type: "selectRows",
          selectors: {},
          rowSelection: {
            mode: "firstAvailable",
            count: 4,
            entityKind: "phoneNumber",
            outputName: "selected.phoneNumbers",
            rowSelector: "tr, [role='row']",
            checkboxSelector: "[role='checkbox'], input[type='checkbox']",
            valuePattern: "\\\\+61\\\\s+2\\\\s+[0-9\\\\s]+",
            unavailableText: "Unavailable|Reserved|Assigned",
            minimumCount: 4
          },
          pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
          pageTitle: "Get Number",
          description: "Select first 4 available phone-number rows"
        },
        {
          id: "done",
          timestamp: 1001,
          type: "click",
          selectors: { role: { role: "button", name: "Done" } },
          pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
          pageTitle: "Get Number",
          description: "Click Done"
        }
      ],
      assertions: [
        {
          afterAction: "done",
          type: "entityExists",
          expected: "{{selected.phoneNumbers}}",
          timeout: 15000,
          onFailure: "screenshot"
        }
      ]
    });

    const result = compileWorkflow(workflow, testOutputDir);
    const flow = readFileSync(path.join(result.outputDir, "flow.ts"), "utf8");

    expect(flow).toContain("const workflowState = new Map<string, string[]>();");
    expect(flow).toContain("await this.selectRows(page");
    expect(flow).toContain('"outputName":"selected.phoneNumbers"');
    expect(flow).toContain('const outputName = policy.outputName ?? "selected.rows";');
    expect(flow).toContain("workflowState.set(outputName, selectedValues)");
    expect(flow).toContain('this.resolveExpected("{{selected.phoneNumbers}}", workflowState)');
    expect(flow).toContain("Expected at least ${minimumCount} available row(s)");
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
