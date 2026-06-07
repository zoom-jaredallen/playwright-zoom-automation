import { describe, expect, it } from "vitest";
import {
  firstRecordableNavigationUrl,
  isIgnoredRecorderNavigationUrl,
  shouldAcceptRecordedAction,
  shouldRecordNavigationUrl
} from "../extension/shared/navigationPolicy.js";
import type { RecordedAction } from "@zoom-automation/workflow-core";

function action(id: string, overrides: Partial<RecordedAction>): RecordedAction {
  return {
    id,
    timestamp: 0,
    type: "navigate",
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
    pageTitle: "Zoom",
    ...overrides
  };
}

describe("extension navigation recording policy", () => {
  it("ignores Zoom Contact Center SDK cross-storage URLs", () => {
    const livesdkUrl = "https://us01ccistatic.zoom.us/us01cci/web-sdk/9523/cross-storage.html?lang=en-US";

    expect(isIgnoredRecorderNavigationUrl(livesdkUrl)).toBe(true);
    expect(shouldRecordNavigationUrl(livesdkUrl)).toBe(false);
    expect(shouldAcceptRecordedAction(action("sdk", {
      pageTitle: "Livesdk",
      pageUrl: livesdkUrl,
      url: livesdkUrl
    }))).toBe(false);
  });

  it("records normal Zoom Admin navigation from the main frame", () => {
    const adminUrl = "https://zoom.us/cpw/page/phoneNumbers#/add-business-address";

    expect(isIgnoredRecorderNavigationUrl(adminUrl)).toBe(false);
    expect(shouldRecordNavigationUrl(adminUrl, { frameId: 0 })).toBe(true);
    expect(shouldAcceptRecordedAction(action("admin", {
      pageTitle: "Add Address - Zoom",
      pageUrl: adminUrl,
      url: adminUrl
    }), { frameId: 0 })).toBe(true);
  });

  it("drops navigation events from subframes while preserving user actions on normal pages", () => {
    const adminUrl = "https://zoom.us/cpw/page/phoneNumbers#/business-address";

    expect(shouldRecordNavigationUrl(adminUrl, { frameId: 12 })).toBe(false);
    expect(shouldAcceptRecordedAction(action("frame-nav", {
      pageUrl: adminUrl,
      url: adminUrl
    }), { frameId: 12 })).toBe(false);
    expect(shouldAcceptRecordedAction(action("frame-click", {
      type: "click",
      pageUrl: adminUrl,
      selectors: { role: { role: "button", name: "Save" } }
    }), { frameId: 12 })).toBe(true);
  });

  it("chooses the first non-SDK navigation URL for workflow start metadata", () => {
    const livesdkUrl = "https://us01ccistatic.zoom.us/us01cci/web-sdk/9523/cross-storage.html?lang=en-US";
    const adminUrl = "https://zoom.us/cpw/page/phoneNumbers#/add-business-address";

    expect(firstRecordableNavigationUrl([
      action("sdk", { pageUrl: livesdkUrl, url: livesdkUrl }),
      action("admin", { pageUrl: adminUrl, url: adminUrl })
    ])).toBe(adminUrl);
  });
});
