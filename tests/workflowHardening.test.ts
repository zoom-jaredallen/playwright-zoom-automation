import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowIntent,
  buildEntityModel,
  buildWorkflow,
  createZoomAdminAdapter,
  hardenRecordedWorkflow,
  type RecordedAction
} from "@zoom-automation/workflow-core";

function action(id: string, overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "click",
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
    pageTitle: "Zoom Admin",
    ...overrides
  };
}

describe("workflow hardening — generic intent analysis", () => {
  it("detects create workflows and side-effecting mutation steps without business-address knowledge", () => {
    const actions = [
      action("open-create", {
        type: "click",
        selectors: { role: { role: "button", name: "Create Queue" } },
        description: "Click Create Queue"
      }),
      action("queue-name", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Queue Name" }, label: "Queue Name" },
        value: "Priority Support"
      }),
      action("queue-extension", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Extension" }, label: "Extension" },
        value: "5001"
      }),
      action("save", {
        type: "click",
        selectors: { role: { role: "button", name: "Save" } },
        networkWaitUrl: "/api/queues",
        description: "Click Save"
      })
    ];

    const analysis = analyzeWorkflowIntent(actions);

    expect(analysis.intent).toBe("create");
    expect(analysis.confidence).toBe("high");
    expect(analysis.entryStepIds).toEqual(["open-create"]);
    expect(analysis.mutationStepIds).toEqual(["save"]);
    expect(analysis.requiresIdempotency).toBe(true);
    expect(analysis.requiresOutcomeAssertion).toBe(true);
    expect(analysis.stepRisks.find((risk) => risk.actionId === "save")?.risk).toBe("mutation");
  });

  it("detects destructive delete workflows and marks confirmation as destructive", () => {
    const actions = [
      action("search-user", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Search" }, label: "Search" },
        value: "michael.chen@example.com"
      }),
      action("delete-user", {
        type: "click",
        selectors: { role: { role: "button", name: "Delete User" } }
      }),
      action("confirm-delete", {
        type: "click",
        selectors: { role: { role: "button", name: "Confirm" } },
        networkWaitUrl: "/api/users/delete"
      })
    ];

    const analysis = analyzeWorkflowIntent(actions);

    expect(analysis.intent).toBe("delete");
    expect(analysis.destructiveStepIds).toEqual(["delete-user", "confirm-delete"]);
    expect(analysis.stepRisks.find((risk) => risk.actionId === "confirm-delete")?.risk).toBe("destructive");
  });

  it("builds a generic entity model from labels, selected values, and filled values", () => {
    const actions = [
      action("setting-toggle", {
        type: "click",
        selectors: {
          role: { role: "switch", name: "Require meeting password" },
          anchor: { text: "Require meeting password", scopeSelector: ".setting-row", kind: "formField", relationship: "nearControl" }
        },
        ariaState: { checked: true }
      }),
      action("lock-setting", {
        type: "click",
        selectors: { role: { role: "button", name: "Lock" } }
      }),
      action("confirm", {
        type: "click",
        selectors: { role: { role: "button", name: "Save" } },
        networkWaitUrl: "/api/account/settings"
      })
    ];

    const model = buildEntityModel(actions, analyzeWorkflowIntent(actions));

    expect(model.operation).toBe("update");
    expect(model.entityKind).toBe("accountSetting");
    expect(model.fingerprintFields).toContainEqual(expect.objectContaining({
      label: "Require meeting password",
      value: "checked"
    }));
    expect(model.desiredState).toEqual(expect.objectContaining({
      exists: true,
      values: expect.objectContaining({ "Require meeting password": "checked" })
    }));
  });

  it("uses Zoom adapter knowledge to normalize Zoom CPZUI entity fingerprints", () => {
    const actions = [
      action("add-address", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        selectors: { role: { role: "button", name: "Add Address" } }
      }),
      action("product", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/add-business-address",
        selectors: { role: { role: "combobox", name: "Product" }, label: "Product" },
        value: "Contact Center"
      }),
      action("number-type", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/add-business-address",
        selectors: { role: { role: "combobox", name: "Number Type & Capability" }, label: "Number Type & Capability" },
        value: "Virtual Service - Incoming Call · Outgoing Call"
      }),
      action("line1", {
        type: "fill",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/add-business-address",
        selectors: { role: { role: "textbox", name: "Address Line 1" }, label: "Address Line 1" },
        value: "9 Castlereagh St"
      }),
      action("save", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/add-business-address",
        selectors: { role: { role: "button", name: "Save" } },
        networkWaitUrl: "/cp/webapi/kyc/business-address"
      })
    ];

    const hardened = hardenRecordedWorkflow({
      actions,
      assertions: [],
      adapter: createZoomAdminAdapter()
    });

    expect(hardened.entity.entityKind).toBe("businessAddress");
    expect(hardened.entity.fingerprintFields).toContainEqual(expect.objectContaining({
      label: "Number Type",
      value: "Virtual Service"
    }));
    expect(hardened.actions.find((step) => step.id === "add-address")?.condition?.match?.allText).toEqual(
      expect.arrayContaining(["Contact Center", "Virtual Service", "9 Castlereagh St"])
    );
  });

  it("uses Zoom adapter knowledge for add-phone-number workflows", () => {
    const actions = [
      action("open-add-number", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        selectors: { role: { role: "button", name: "Add Number" } },
        description: "Expand \"Add Number\"",
        ariaState: { expanded: true }
      }),
      action("get-number", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        selectors: { text: "Get Number" },
        description: "Click \"Get Number\""
      }),
      action("product", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "combobox", name: "Product" }, label: "Product" },
        value: "Phone"
      }),
      action("country", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "combobox", name: "Country/Region" }, label: "Country/Region" },
        value: "Australia"
      }),
      action("state", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "combobox", name: "State/Province/Territory" }, label: "State/Province/Territory" },
        value: "New South Wales (NSW)"
      }),
      action("city", {
        type: "fill",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "textbox", name: "City" }, label: "City" },
        value: "Sydney"
      }),
      action("select-1", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox", name: "+61 2 9127 5053" },
          anchor: { text: "+61 2 9127 5053", scopeSelector: "tr, [role='row']", kind: "row", relationship: "within" }
        },
        ariaState: { checked: true }
      }),
      action("continue", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "button", name: "Continue" } },
        networkWaitUrl: "/cp/webapi/phone-number/reserve"
      }),
      action("done", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "button", name: "Done" } },
        networkWaitUrl: "/cp/webapi/phone-number/assign"
      })
    ];

    const hardened = hardenRecordedWorkflow({
      actions,
      assertions: [],
      adapter: createZoomAdminAdapter()
    });

    expect(hardened.entity.entityKind).toBe("phoneNumber");
    expect(hardened.entity.fingerprintFields).toContainEqual(expect.objectContaining({
      label: "Phone Number",
      value: "+61 2 9127 5053"
    }));
    expect(hardened.entity.fingerprintFields).not.toContainEqual(expect.objectContaining({
      label: "Add Number",
      value: "expanded"
    }));
    expect(hardened.actions.find((step) => step.id === "open-add-number")?.condition).toEqual({
      type: "entityStateGuard",
      operation: "assign",
      entityKind: "phoneNumber",
      match: { allText: ["+61 2 9127 5053"] },
      whenMatched: "skipAccount"
    });
    expect(hardened.assertions).toContainEqual(expect.objectContaining({
      afterAction: "done",
      type: "entityExists",
      expected: "+61 2 9127 5053"
    }));
  });

  it("adds form-field anchors to recorded Zoom select controls", () => {
    const actions = [
      action("country", {
        type: "select",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "combobox", name: "Country/Region" } },
        selectorCandidates: [
          { id: "role-country", kind: "role", selector: { role: { role: "combobox", name: "Country/Region" } } },
          { id: "css-country", kind: "css", selector: { css: "div:nth-child(1) > div > div > input" } }
        ],
        selectMetadata: {
          targetCandidates: [
            { id: "role-country", kind: "role", selector: { role: { role: "combobox", name: "Country/Region" } } }
          ],
          optionLabel: "Australia"
        },
        value: "{{address.country}}",
        description: "Select \"Australia\" in Country/Region"
      })
    ];

    const hardened = hardenRecordedWorkflow({ actions, assertions: [], adapter: createZoomAdminAdapter() });
    const country = hardened.actions.find((step) => step.id === "country");

    expect(country?.selectors.anchor).toEqual(expect.objectContaining({
      text: "Country/Region",
      kind: "formField",
      relationship: "nearControl"
    }));
    expect(country?.selectorCandidates?.every((candidate) => candidate.selector.anchor?.text === "Country/Region")).toBe(true);
    expect(country?.selectMetadata?.targetCandidates?.every((candidate) => candidate.selector.anchor?.text === "Country/Region")).toBe(true);
  });

  it("replaces stale generated idempotency guards when entity inference improves", () => {
    const actions = [
      action("open-add-number", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        selectors: { role: { role: "button", name: "Add Number" } },
        description: "Expand \"Add Number\"",
        condition: {
          type: "entityStateGuard",
          operation: "create",
          entityKind: "businessAddress",
          match: { allText: ["expanded", "Phone", "{{address.country}}"] },
          whenMatched: "skipAccount"
        }
      }),
      action("get-number", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        selectors: { text: "Get Number" },
        description: "Click \"Get Number\""
      }),
      action("select-number", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox" },
          anchor: { text: "+61 2 9127 5053", scopeRole: "row", kind: "row", relationship: "within" }
        },
        description: "Toggle checkbox \"\""
      }),
      action("done", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "button", name: "Done" } },
        networkWaitUrl: "/cp/webapi/phone-number/assign"
      })
    ];

    const hardened = hardenRecordedWorkflow({
      actions,
      assertions: [],
      adapter: createZoomAdminAdapter()
    });

    expect(hardened.actions.find((step) => step.id === "open-add-number")?.condition).toEqual({
      type: "entityStateGuard",
      operation: "assign",
      entityKind: "phoneNumber",
      match: { allText: ["+61 2 9127 5053"] },
      whenMatched: "skipAccount"
    });
  });

  it("collapses recorded phone-number checkbox clicks into a dynamic first-available row selection", () => {
    const actions = [
      action("search", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "button", name: "Search" } },
        description: "Click \"Search\""
      }),
      action("select-1", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox" },
          anchor: { text: "+61 2 9127 5053", scopeRole: "row", kind: "row", relationship: "within" }
        },
        description: "Toggle checkbox \"\""
      }),
      action("select-2", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox" },
          anchor: { text: "+61 2 9127 5054", scopeRole: "row", kind: "row", relationship: "within" }
        },
        description: "Toggle checkbox \"\""
      }),
      action("select-3", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox" },
          anchor: { text: "+61 2 7235 9093", scopeRole: "row", kind: "row", relationship: "within" }
        },
        description: "Toggle checkbox \"\""
      }),
      action("select-4", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: {
          role: { role: "checkbox" },
          anchor: { text: "+61 2 7235 0047", scopeRole: "row", kind: "row", relationship: "within" }
        },
        description: "Toggle checkbox \"\""
      }),
      action("done", {
        type: "click",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        selectors: { role: { role: "button", name: "Done" } },
        networkWaitUrl: "/cp/webapi/phone-number/assign",
        description: "Click \"Done\""
      })
    ];

    const hardened = hardenRecordedWorkflow({
      actions,
      assertions: [],
      adapter: createZoomAdminAdapter()
    });

    const rowSelection = hardened.actions.find((step) => step.type === "selectRows");
    expect(rowSelection).toEqual(expect.objectContaining({
      id: "select-1",
      type: "selectRows",
      description: "Select first 4 available phone-number rows"
    }));
    expect(rowSelection?.rowSelection).toEqual(expect.objectContaining({
      mode: "firstAvailable",
      count: 4,
      entityKind: "phoneNumber",
      outputName: "selected.phoneNumbers"
    }));
    expect(hardened.actions.find((step) => step.id === "search")?.condition).toBeUndefined();
    expect(hardened.actions.filter((step) => step.description === "Toggle checkbox \"\"")).toHaveLength(0);
    expect(hardened.assertions).toContainEqual(expect.objectContaining({
      afterAction: "done",
      type: "entityExists",
      expected: "{{selected.phoneNumbers}}"
    }));
  });

  it("does not create preflight guards from runtime-selected values and replaces stale entity assertions", () => {
    const actions = [
      action("open", {
        type: "click",
        selectors: { role: { role: "button", name: "Add Number" } },
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        description: "Expand \"Add Number\"",
        condition: {
          type: "entityStateGuard",
          operation: "create",
          entityKind: "businessAddress",
          match: { allText: ["expanded", "Phone", "{{address.country}}", "{{address.line1}}"] },
          whenMatched: "skipAccount"
        }
      }),
      action("select-rows", {
        type: "selectRows",
        selectors: {},
        rowSelection: {
          mode: "firstAvailable",
          count: 4,
          entityKind: "phoneNumber",
          outputName: "selected.phoneNumbers"
        },
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        description: "Select first 4 available phone-number rows"
      }),
      action("done", {
        type: "click",
        selectors: { role: { role: "button", name: "Done" } },
        networkWaitUrl: "/cp/webapi/phone-number/assign",
        pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/get-number",
        description: "Click Done"
      })
    ];

    const hardened = hardenRecordedWorkflow({
      actions,
      assertions: [{
        afterAction: "done",
        type: "entityExists",
        expected: "expanded|Phone|{{address.country}}|{{address.line1}}",
        timeout: 15_000,
        onFailure: "screenshot"
      }],
      adapter: createZoomAdminAdapter()
    });

    expect(hardened.actions.find((step) => step.id === "open")?.condition).toBeUndefined();
    expect(hardened.assertions).toEqual([
      expect.objectContaining({
        afterAction: "done",
        type: "entityExists",
        expected: "{{selected.phoneNumbers}}"
      })
    ]);
    expect(hardened.report.bulkReady).toBe(false);
    expect(hardened.report.warnings).toContain("No idempotency guard could be generated.");
  });

  it("auto-hardens workflows built from recorder actions", () => {
    const workflow = buildWorkflow({
      actions: [
        action("open-create", {
          type: "click",
          selectors: { role: { role: "button", name: "Create Queue" } },
          description: "Click Create Queue"
        }),
        action("queue-name", {
          type: "fill",
          selectors: { role: { role: "textbox", name: "Queue Name" }, label: "Queue Name" },
          value: "Priority Support"
        }),
        action("queue-extension", {
          type: "fill",
          selectors: { role: { role: "textbox", name: "Extension" }, label: "Extension" },
          value: "5001"
        }),
        action("save", {
          type: "click",
          selectors: { role: { role: "button", name: "Save" } },
          networkWaitUrl: "/api/queues"
        })
      ],
      recordingStartUrl: "https://zoom.us/cpw/page/contactCenter#/queues",
      recordingStartTime: 1000,
      impersonationDetected: true,
      nowMs: 2000
    });

    expect(workflow.actions.find((step) => step.id === "open-create")?.condition?.type).toBe("entityStateGuard");
    expect(workflow.assertions).toContainEqual(expect.objectContaining({
      afterAction: "save",
      type: "entityExists",
      expected: "Priority Support|5001"
    }));
    expect(workflow.assertions).not.toContainEqual(expect.objectContaining({
      afterAction: "save",
      type: "textVisible",
      expected: "success|saved|added|submitted"
    }));
    expect(workflow.hardening?.bulkReady).toBe(true);
  });

  it("annotates hardened Zoom steps with reusable intent metadata", () => {
    const hardened = hardenRecordedWorkflow({
      adapter: createZoomAdminAdapter(),
      actions: [
        action("product", {
          type: "select",
          selectors: { role: { role: "combobox", name: "Product" }, label: "Product" },
          value: "Phone",
          selectMetadata: { optionLabel: "Phone" }
        }),
        action("city", {
          type: "fill",
          selectors: { role: { role: "textbox", name: "City" }, label: "City" },
          value: "Sydney"
        }),
        action("select-rows", {
          type: "selectRows",
          selectors: {},
          rowSelection: { mode: "firstAvailable", count: 4, minimumCount: 4, entityKind: "phoneNumber", valuePattern: "\\+61" }
        }),
        action("done", {
          type: "click",
          selectors: { role: { role: "button", name: "Done" } },
          networkWaitUrl: "/cp/webapi/phone-number/assign"
        })
      ],
      assertions: []
    });

    expect(hardened.actions.find((step) => step.id === "product")).toEqual(expect.objectContaining({
      intentType: "zoom.selectComboboxOption",
      intentMetadata: expect.objectContaining({ fieldLabel: "Product", optionLabel: "Phone", source: "hardened" })
    }));
    expect(hardened.actions.find((step) => step.id === "city")).toEqual(expect.objectContaining({
      intentType: "zoom.fillFieldByLabel",
      intentMetadata: expect.objectContaining({ fieldLabel: "City", source: "hardened" })
    }));
    expect(hardened.actions.find((step) => step.id === "select-rows")).toEqual(expect.objectContaining({
      intentType: "zoom.selectTableRows",
      intentMetadata: expect.objectContaining({ tableEntityKind: "phoneNumber", rowCount: 4, source: "hardened" })
    }));
    expect(hardened.actions.find((step) => step.id === "done")).toEqual(expect.objectContaining({
      intentType: "zoom.clickPrimaryAction",
      intentMetadata: expect.objectContaining({ mutationBoundary: true, source: "hardened" })
    }));
  });
});

describe("workflow hardening — automatic safeguards", () => {
  it("adds idempotency, outcome assertion, and no-retry mutation policy for create workflows", () => {
    const actions = [
      action("open-create", {
        type: "click",
        selectors: { role: { role: "button", name: "Create Queue" } },
        description: "Click Create Queue"
      }),
      action("queue-name", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Queue Name" }, label: "Queue Name" },
        value: "Priority Support"
      }),
      action("queue-extension", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Extension" }, label: "Extension" },
        value: "5001"
      }),
      action("save", {
        type: "click",
        selectors: { role: { role: "button", name: "Save" } },
        retryCount: 2,
        networkWaitUrl: "/api/queues"
      })
    ];

    const hardened = hardenRecordedWorkflow({ actions, assertions: [] });

    expect(hardened.actions.find((step) => step.id === "open-create")?.condition).toEqual({
      type: "entityStateGuard",
      operation: "create",
      entityKind: "queue",
      match: { allText: ["Priority Support", "5001"] },
      whenMatched: "skipAccount"
    });
    expect(hardened.actions.find((step) => step.id === "save")).toEqual(expect.objectContaining({
      retryCount: 0,
      continueOnFailure: false,
      screenshotOnFailure: true,
      sideEffectRisk: "mutation"
    }));
    expect(hardened.assertions).toContainEqual(expect.objectContaining({
      afterAction: "save",
      type: "entityExists",
      expected: "Priority Support|5001"
    }));
    expect(hardened.report.bulkReady).toBe(true);
  });

  it("generates absence assertions for delete workflows and keeps destructive steps no-retry", () => {
    const actions = [
      action("search-user", {
        type: "fill",
        selectors: { role: { role: "textbox", name: "Search" }, label: "Search" },
        value: "michael.chen@example.com"
      }),
      action("delete-user", {
        type: "click",
        selectors: { role: { role: "button", name: "Delete User" } }
      }),
      action("confirm-delete", {
        type: "click",
        selectors: { role: { role: "button", name: "Confirm" } },
        retryCount: 3,
        networkWaitUrl: "/api/users/delete"
      })
    ];

    const hardened = hardenRecordedWorkflow({ actions, assertions: [] });

    expect(hardened.actions.find((step) => step.id === "confirm-delete")).toEqual(expect.objectContaining({
      retryCount: 0,
      sideEffectRisk: "destructive"
    }));
    expect(hardened.assertions).toContainEqual(expect.objectContaining({
      afterAction: "confirm-delete",
      type: "entityAbsent",
      expected: "michael.chen@example.com"
    }));
  });
});
