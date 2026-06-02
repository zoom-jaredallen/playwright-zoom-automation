import { describe, expect, it } from "vitest";
import {
  businessAddressAppearsInPageText,
  countryLabel,
  findBusinessAddressStatusInPageText,
  isDismissibleZoomDialogText,
  optionNamePattern
} from "../src/zoom/businessAddressFlow.js";

describe("businessAddressAppearsInPageText", () => {
  it("matches a Zoom-formatted address whose suite appears after the street", () => {
    const pageText = "9 Castlereagh St, Level 1, Sydney, NSW 2000 Australia Toll";

    expect(
      businessAddressAppearsInPageText(pageText, {
        line1: "Level 1/9 Castlereagh St",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU"
      })
    ).toBe(true);
  });

  it("does not match a different address with the same city", () => {
    const pageText = "123 Other St, Sydney, NSW 2000 Australia Toll";

    expect(
      businessAddressAppearsInPageText(pageText, {
        line1: "Level 1/9 Castlereagh St",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU"
      })
    ).toBe(false);
  });

  it("matches Singapore when the page spells out the ISO country code", () => {
    const pageText = "2 Central Blvd, #24-01A, Singapore 018916 Singapore Toll Pending";

    expect(
      businessAddressAppearsInPageText(pageText, {
        line1: "2 Central Blvd",
        line2: "#24-01A",
        city: "Singapore",
        postalCode: "018916",
        country: "SG"
      })
    ).toBe(true);
  });

  it("does not treat an existing Toll-free row as a configured Toll address", () => {
    const pageText = "9 Castlereagh St, Level 1, Sydney, NSW 2000 Australia Toll-free Pending";

    expect(
      businessAddressAppearsInPageText(pageText, {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        numberType: "Toll"
      })
    ).toBe(false);
  });

  it("matches a configured Toll address row", () => {
    const pageText = "9 Castlereagh St, Level 1, Sydney, NSW 2000 Australia Toll Pending";

    expect(
      businessAddressAppearsInPageText(pageText, {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        numberType: "Toll"
      })
    ).toBe(true);
  });
});

describe("findBusinessAddressStatusInPageText", () => {
  it("reports the verification status for a configured Toll address row", () => {
    const pageText =
      "Business addresses 9 Castlereagh St, Level 1, Sydney, NSW 2000 Australia Toll Zoom Phone Pending Actions";

    expect(
      findBusinessAddressStatusInPageText(pageText, {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        numberType: "Toll"
      })
    ).toEqual({ present: true, verificationStatus: "Pending" });
  });

  it("does not report a Toll-free row as the configured Toll address", () => {
    const pageText =
      "Business addresses 9 Castlereagh St, Level 1, Sydney, NSW 2000 Australia Toll-free Zoom Phone Verified Actions";

    expect(
      findBusinessAddressStatusInPageText(pageText, {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        numberType: "Toll"
      })
    ).toEqual({ present: false });
  });

  it("returns not present when the configured address is missing", () => {
    const pageText = "Business addresses 123 Other St, Sydney, NSW 2000 Australia Toll Pending";

    expect(
      findBusinessAddressStatusInPageText(pageText, {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        numberType: "Toll"
      })
    ).toEqual({ present: false });
  });
});

describe("countryLabel", () => {
  it("maps supported ISO country codes to Zoom option labels", () => {
    expect(countryLabel("AU")).toBe("Australia");
    expect(countryLabel("SG")).toBe("Singapore");
    expect(countryLabel("US")).toBe("United States");
  });
});

describe("isDismissibleZoomDialogText", () => {
  it("recognizes the Custom AI Companion announcement popup", () => {
    expect(isDismissibleZoomDialogText("Custom AI Companion is now available for your account")).toBe(true);
  });

  it("does not treat business address dialogs as dismissible popups", () => {
    expect(isDismissibleZoomDialogText("Add Address Country/Region Number Type & Capability")).toBe(false);
  });
});

describe("optionNamePattern", () => {
  it("matches Toll without matching Toll-free", () => {
    const pattern = optionNamePattern("Toll");

    expect(pattern.test("Toll - Incoming Call · Outgoing Call")).toBe(true);
    expect(pattern.test("Toll-free - Incoming Call")).toBe(false);
  });
});
