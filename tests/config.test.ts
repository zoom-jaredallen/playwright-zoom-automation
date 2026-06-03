import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const baseEnv = {
    ZOOM_ADMIN_EMAIL: "admin@example.com",
    ZOOM_ADMIN_PASSWORD: "secret-password",
    ZOOM_API_ACCESS_TOKEN: "api-token",
    BUSINESS_ADDRESS_LINE1: "55 Almaden Blvd",
    BUSINESS_ADDRESS_CITY: "San Jose",
    BUSINESS_ADDRESS_STATE: "CA",
    BUSINESS_ADDRESS_POSTAL_CODE: "95113",
    BUSINESS_ADDRESS_COUNTRY: "US",
    BUSINESS_ADDRESS_CUSTOMER_NAME: "Example Customer",
    BUSINESS_ADDRESS_CONTACT_NAME: "Jane Admin",
    BUSINESS_ADDRESS_CONTACT_NUMBER: "+14155550100",
    BUSINESS_ADDRESS_CONTACT_EMAIL: "jane@example.com",
    DOCUMENT_ID_PATH: "/tmp/id.pdf",
    DOCUMENT_BUSINESS_VERIFICATION_PATH: "/tmp/business.pdf"
  };

  it("loads required Zoom, address, and document settings", () => {
    const config = loadConfig(baseEnv);

    expect(config.zoom.adminEmail).toBe("admin@example.com");
    expect(config.zoom.apiBaseUrl).toBe("https://api.zoom.us/v2");
    expect(config.address.city).toBe("San Jose");
    expect(config.address.customerName).toBe("Example Customer");
    expect(config.address.contactName).toBe("Jane Admin");
    expect(config.address.contactNumber).toBe("+14155550100");
    expect(config.address.contactEmail).toBe("jane@example.com");
    expect(config.address.numberType).toBe("Toll");
    expect(config.documents.idPath).toBe("/tmp/id.pdf");
    expect(config.runtime.headless).toBe(true);
    expect(config.runtime.accountLimit).toBeUndefined();
    expect(config.runtime.flowRetryAttempts).toBe(2);
    expect(config.runtime.flowRetryBaseDelayMs).toBe(5_000);
    expect(config.runtime.accountDelayMs).toBe(0);
  });

  it("loads address and document settings from a selected YAML profile", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "address-profiles-"));
    try {
      const profilesPath = path.join(directory, "addresses.yaml");
      await writeFile(
        profilesPath,
        [
          "profiles:",
          "  australia_default:",
          "    country: AU",
          "    numberType: Toll",
          "    customerName: Zoom Communications Ltd",
          "    address:",
          "      line1: 9 Castlereagh St",
          "      line2: Level 1",
          "      city: Sydney",
          "      state: NSW",
          "      postalCode: '2000'",
          "    contact:",
          "      name: Zoom Communications Ltd",
          "      email: admin@example.com",
          "    documents:",
          "      required: false",
          ""
        ].join("\n")
      );

      const config = loadConfig({
        ZOOM_ADMIN_EMAIL: "admin@example.com",
        ZOOM_ADMIN_PASSWORD: "secret-password",
        ZOOM_API_ACCESS_TOKEN: "api-token",
        ADDRESS_PROFILE: "australia_default",
        ADDRESS_PROFILES_PATH: profilesPath
      });

      expect(config.address).toMatchObject({
        country: "AU",
        numberType: "Toll",
        customerName: "Zoom Communications Ltd",
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        contactName: "Zoom Communications Ltd",
        contactEmail: "admin@example.com"
      });
      expect(config.documents.required).toBe(false);
      expect(config.documents.idPath).toBeUndefined();
      expect(config.documents.businessVerificationPath).toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("parses optional runtime controls", () => {
    const config = loadConfig({
      ...baseEnv,
      HEADLESS: "false",
      DRY_RUN: "true",
      SUB_ACCOUNT_LIMIT: "25",
      SUB_ACCOUNT_IDS: "abc, def ,ghi",
      SUB_ACCOUNT_OWNER_FROM: "michael.chen@lab494-s301.zoomdemos.com",
      SUB_ACCOUNT_OWNER_TO: "michael.chen@lab494-s350.zoomdemos.com",
      FLOW_RETRY_ATTEMPTS: "4",
      FLOW_RETRY_BASE_DELAY_MS: "2500",
      ACCOUNT_DELAY_MS: "100",
      BUSINESS_ADDRESS_NUMBER_TYPE: "Mobile",
      PROGRESS_PATH: "output/custom-progress.json"
    });

    expect(config.runtime.headless).toBe(false);
    expect(config.runtime.dryRun).toBe(true);
    expect(config.runtime.accountLimit).toBe(25);
    expect(config.runtime.accountIds).toEqual(["abc", "def", "ghi"]);
    expect(config.runtime.ownerRange).toEqual({
      from: "michael.chen@lab494-s301.zoomdemos.com",
      to: "michael.chen@lab494-s350.zoomdemos.com"
    });
    expect(config.runtime.flowRetryAttempts).toBe(4);
    expect(config.runtime.flowRetryBaseDelayMs).toBe(2500);
    expect(config.runtime.accountDelayMs).toBe(100);
    expect(config.address.numberType).toBe("Mobile");
    expect(config.runtime.progressPath).toBe("output/custom-progress.json");
  });

  it("requires either a static API token or server-to-server OAuth credentials", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        ZOOM_API_ACCESS_TOKEN: ""
      })
    ).toThrow(/ZOOM_API_ACCESS_TOKEN.*ZOOM_SERVER_TO_SERVER/s);
  });

  it("reports all missing required fields at once", () => {
    expect(() => loadConfig({})).toThrow(/ZOOM_ADMIN_EMAIL/);
  });

  it("reports a missing selected YAML profile", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "address-profiles-"));
    try {
      const profilesPath = path.join(directory, "addresses.yaml");
      await writeFile(profilesPath, "profiles:\n  australia_default:\n    country: AU\n");

      expect(() =>
        loadConfig({
          ZOOM_ADMIN_EMAIL: "admin@example.com",
          ZOOM_ADMIN_PASSWORD: "secret-password",
          ZOOM_API_ACCESS_TOKEN: "api-token",
          ADDRESS_PROFILE: "missing_profile",
          ADDRESS_PROFILES_PATH: profilesPath
        })
      ).toThrow(/Address profile not found: missing_profile/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("defaults contact name and email from customer/admin settings", () => {
    const config = loadConfig({
      ...baseEnv,
      BUSINESS_ADDRESS_CONTACT_NAME: "",
      BUSINESS_ADDRESS_CONTACT_NUMBER: "",
      BUSINESS_ADDRESS_CONTACT_EMAIL: ""
    });

    expect(config.address.contactName).toBe("Example Customer");
    expect(config.address.contactNumber).toBeUndefined();
    expect(config.address.contactEmail).toBe("admin@example.com");
  });

  it("rejects invalid retry and delay controls", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        FLOW_RETRY_ATTEMPTS: "0"
      })
    ).toThrow(/positive integer/);

    expect(() =>
      loadConfig({
        ...baseEnv,
        ACCOUNT_DELAY_MS: "-1"
      })
    ).toThrow(/zero or a positive integer/);
  });

  it("requires both owner range endpoints when owner filtering is configured", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SUB_ACCOUNT_OWNER_FROM: "michael.chen@lab494-s301.zoomdemos.com"
      })
    ).toThrow(/SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must be configured together/);
  });
});
