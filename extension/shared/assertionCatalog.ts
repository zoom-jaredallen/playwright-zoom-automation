import type { AssertionType, OnFailure, RecordedAction } from "@zoom-automation/workflow-core";

export interface AssertionCatalogItem {
  type: AssertionType;
  label: string;
  placeholder: string;
  defaultExpected: string;
  needsSelector: boolean;
}

export const assertionCatalog = {
  textVisible: {
    type: "textVisible",
    label: "Text exists",
    placeholder: "Saved",
    defaultExpected: "Saved",
    needsSelector: false
  },
  elementVisible: {
    type: "elementVisible",
    label: "Element visible",
    placeholder: "CSS selector or pick a target",
    defaultExpected: "",
    needsSelector: true
  },
  fieldValue: {
    type: "fieldValue",
    label: "Field value equals",
    placeholder: "Expected field value",
    defaultExpected: "",
    needsSelector: true
  },
  tableRowContains: {
    type: "tableRowContains",
    label: "Row contains value",
    placeholder: "Row text",
    defaultExpected: "",
    needsSelector: false
  },
  addressStatusEquals: {
    type: "addressStatusEquals",
    label: "Address status equals",
    placeholder: "Pending, Verified, or Rejected",
    defaultExpected: "Verified",
    needsSelector: false
  },
  urlContains: {
    type: "urlContains",
    label: "URL contains",
    placeholder: "#/business-address",
    defaultExpected: "",
    needsSelector: false
  },
  urlMatches: {
    type: "urlMatches",
    label: "URL matches",
    placeholder: "#/business-address$",
    defaultExpected: "",
    needsSelector: false
  },
  toastVisible: {
    type: "toastVisible",
    label: "Toast or banner appears",
    placeholder: "Saved",
    defaultExpected: "Saved",
    needsSelector: false
  }
} satisfies Record<string, AssertionCatalogItem>;

export function assertionOptionsForUi(): Array<{ value: AssertionType; label: string }> {
  return Object.values(assertionCatalog).map((item) => ({ value: item.type, label: item.label }));
}

export function defaultAssertionInput(assertionType: AssertionType): Pick<RecordedAction, "assertionType" | "expected" | "timeout" | "onFailure"> {
  const item = assertionCatalog[assertionType as keyof typeof assertionCatalog] ?? assertionCatalog.textVisible;
  return {
    assertionType: item.type,
    expected: item.defaultExpected,
    timeout: 10_000,
    onFailure: "screenshot" satisfies OnFailure
  };
}
