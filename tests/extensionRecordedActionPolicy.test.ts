import { describe, expect, it } from "vitest";
import type { RecordedAction } from "@zoom-automation/workflow-core";
import {
  insertRecordedAction,
  prepareRecordedActionsForWorkflow
} from "../extension/shared/recordedActionPolicy.js";

function action(id: string, overrides: Partial<RecordedAction>): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "navigate",
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list?pageNumber=1&pageSize=15",
    pageTitle: "Phone Numbers - Zoom",
    ...overrides
  };
}

describe("extension recorded action policy", () => {
  it("drops duplicate SPA navigation events for the same URL captured in a short window", () => {
    const businessAddressUrl = "https://zoom.us/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1";
    const first = action("nav-1", {
      timestamp: 1_000,
      url: businessAddressUrl,
      pageUrl: businessAddressUrl,
      description: "Navigate to Business Address & Documents - Zoom"
    });
    const duplicate = action("nav-2", {
      timestamp: 1_006,
      url: businessAddressUrl,
      pageUrl: businessAddressUrl,
      description: "Navigate to Business Address & Documents - Zoom"
    });

    const next = insertRecordedAction([first], duplicate);

    expect(next).toEqual([first]);
  });

  it("orders delayed captured clicks by event timestamp instead of thumbnail completion time", () => {
    const numberListUrl = "https://zoom.us/cpw/page/phoneNumbers#/number-list?pageNumber=1&pageSize=15";
    const businessAddressUrl = "https://zoom.us/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1";
    const initial = action("start", {
      timestamp: 1_000,
      url: numberListUrl,
      pageUrl: numberListUrl
    });
    const navigation = action("nav", {
      timestamp: 1_200,
      url: businessAddressUrl,
      pageUrl: businessAddressUrl
    });
    const click = action("click", {
      timestamp: 1_100,
      type: "click",
      pageUrl: numberListUrl,
      selectors: { text: "Business Address & Documents" },
      description: "Click \"Business Address & Documents\""
    });

    const afterNavigation = insertRecordedAction([initial], navigation);
    const afterDelayedClick = insertRecordedAction(afterNavigation, click);

    expect(afterDelayedClick.map((step) => step.id)).toEqual(["start", "click", "nav"]);
  });

  it("collapses consecutive identical navigation steps when building workflow output", () => {
    const businessAddressUrl = "https://zoom.us/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1";
    const steps = [
      action("nav-1", { timestamp: 1_000, url: businessAddressUrl, pageUrl: businessAddressUrl }),
      action("nav-2", { timestamp: 1_200, url: businessAddressUrl, pageUrl: businessAddressUrl }),
      action("click", {
        timestamp: 1_400,
        type: "click",
        pageUrl: businessAddressUrl,
        selectors: { role: { role: "button", name: "Add Address" } }
      })
    ];

    expect(prepareRecordedActionsForWorkflow(steps).map((step) => step.id)).toEqual(["nav-1", "click"]);
  });

  it("drops duplicate fill events for the same durable target and value", () => {
    const first = action("line1-fill-1", {
      timestamp: 2_000,
      type: "fill",
      value: "9 Castlereagh St",
      selectors: {
        role: { role: "textbox", name: "Address Line 1" },
        label: "Address Line 1",
        css: "input.cpzui-input__inner"
      }
    });
    const duplicate = action("line1-fill-2", {
      timestamp: 4_800,
      type: "fill",
      value: "9 Castlereagh St",
      selectors: {
        role: { role: "textbox", name: "Address Line 1" },
        label: "Address Line 1",
        css: "input.cpzui-input__inner"
      }
    });

    const next = insertRecordedAction([first], duplicate);

    expect(next).toEqual([first]);
  });

  it("keeps fill events with the same value when durable targets differ", () => {
    const city = action("city-fill", {
      timestamp: 2_000,
      type: "fill",
      value: "Sydney",
      selectors: {
        role: { role: "textbox", name: "City" },
        css: "input.cpzui-input__inner"
      }
    });
    const address = action("address-fill", {
      timestamp: 2_500,
      type: "fill",
      value: "Sydney",
      selectors: {
        role: { role: "textbox", name: "Address Line 1" },
        css: "input.cpzui-input__inner"
      }
    });

    expect(insertRecordedAction([city], address).map((step) => step.id)).toEqual(["city-fill", "address-fill"]);
  });

  it("drops duplicate fill events when recorder metadata differs but the fill description target matches", () => {
    const first = action("line1-fill-1", {
      timestamp: 2_000,
      type: "fill",
      value: "9 Castlereagh St",
      description: "Fill \"Address Line 1\" with \"9 Castlereagh St\"",
      selectors: {
        css: "input.cpzui-input__inner:nth-of-type(1)"
      }
    });
    const duplicate = action("line1-fill-2", {
      timestamp: 3_000,
      type: "fill",
      value: "9 Castlereagh St",
      description: "Fill \"Address Line 1\" with \"9 Castlereagh St\"",
      selectors: {
        css: "input.cpzui-input__inner:nth-of-type(2)"
      }
    });

    expect(insertRecordedAction([first], duplicate)).toEqual([first]);
  });

  it("keeps fill events with the same value when description targets differ", () => {
    const line1 = action("line1-fill", {
      timestamp: 2_000,
      type: "fill",
      value: "Sydney",
      description: "Fill \"Address Line 1\" with \"Sydney\"",
      selectors: {
        css: "input.cpzui-input__inner"
      }
    });
    const city = action("city-fill", {
      timestamp: 2_500,
      type: "fill",
      value: "Sydney",
      description: "Fill \"City\" with \"Sydney\"",
      selectors: {
        css: "input.cpzui-input__inner"
      }
    });

    expect(insertRecordedAction([line1], city).map((step) => step.id)).toEqual(["line1-fill", "city-fill"]);
  });

  it("collapses consecutive duplicate fills when building workflow output", () => {
    const steps = [
      action("state-fill-1", {
        timestamp: 1_000,
        type: "fill",
        value: "NSW",
        selectors: { label: "State/Province/Territory" }
      }),
      action("state-fill-2", {
        timestamp: 7_000,
        type: "fill",
        value: "NSW",
        selectors: { label: "State/Province/Territory" }
      }),
      action("city-fill", {
        timestamp: 8_000,
        type: "fill",
        value: "Sydney",
        selectors: { label: "City" }
      })
    ];

    expect(prepareRecordedActionsForWorkflow(steps).map((step) => step.id)).toEqual(["state-fill-1", "city-fill"]);
  });

  it("keeps repeated navigation to the same URL when user actions occur between visits", () => {
    const businessAddressUrl = "https://zoom.us/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1";
    const steps = [
      action("nav-1", { timestamp: 1_000, url: businessAddressUrl, pageUrl: businessAddressUrl }),
      action("click", {
        timestamp: 1_200,
        type: "click",
        pageUrl: businessAddressUrl,
        selectors: { role: { role: "button", name: "Add Address" } }
      }),
      action("nav-2", { timestamp: 1_400, url: businessAddressUrl, pageUrl: businessAddressUrl })
    ];

    expect(prepareRecordedActionsForWorkflow(steps).map((step) => step.id)).toEqual(["nav-1", "click", "nav-2"]);
  });
});
