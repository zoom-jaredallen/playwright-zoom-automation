import { describe, expect, it } from "vitest";
import { parseEnvWithSchema } from "../src/configSchema.js";

const validEnv = {
  ZOOM_ADMIN_EMAIL: "admin@example.com",
  ZOOM_ADMIN_PASSWORD: "secret",
  ZOOM_API_ACCESS_TOKEN: "token-123",
  ZOOM_WEB_BASE_URL: "https://zoom.us",
  ZOOM_API_BASE_URL: "https://api.zoom.us/v2"
};

describe("parseEnvWithSchema", () => {
  it("parses a valid minimal environment", () => {
    const result = parseEnvWithSchema(validEnv as unknown as NodeJS.ProcessEnv);
    expect(result.ZOOM_ADMIN_EMAIL).toBe("admin@example.com");
    expect(result.ZOOM_API_ACCESS_TOKEN).toBe("token-123");
    expect(result.HEADLESS).toBe(true);
    expect(result.DRY_RUN).toBe(false);
    expect(result.CONCURRENCY).toBe(1);
    expect(result.FLOW_RETRY_ATTEMPTS).toBe(2);
  });

  it("applies defaults for optional fields", () => {
    const result = parseEnvWithSchema(validEnv as unknown as NodeJS.ProcessEnv);
    expect(result.ZOOM_WEB_BASE_URL).toBe("https://zoom.us");
    expect(result.ZOOM_API_BASE_URL).toBe("https://api.zoom.us/v2");
    expect(result.PROGRESS_PATH).toBe("output/progress.json");
    expect(result.ARTIFACTS_DIR).toBe("output/artifacts");
    expect(result.ACCOUNT_DELAY_MS).toBe(0);
  });

  it("parses boolean values correctly", () => {
    const result = parseEnvWithSchema({
      ...validEnv,
      HEADLESS: "false",
      DRY_RUN: "1"
    } as unknown as NodeJS.ProcessEnv);
    expect(result.HEADLESS).toBe(false);
    expect(result.DRY_RUN).toBe(true);
  });

  it("parses CSV account IDs", () => {
    const result = parseEnvWithSchema({
      ...validEnv,
      SUB_ACCOUNT_IDS: "acc-1, acc-2, acc-3"
    } as unknown as NodeJS.ProcessEnv);
    expect(result.SUB_ACCOUNT_IDS).toEqual(["acc-1", "acc-2", "acc-3"]);
  });

  it("rejects missing required fields with clear messages", () => {
    expect(() => parseEnvWithSchema({} as unknown as NodeJS.ProcessEnv)).toThrow(
      /Configuration validation failed/
    );
    expect(() => parseEnvWithSchema({} as unknown as NodeJS.ProcessEnv)).toThrow(
      /ZOOM_ADMIN_EMAIL/
    );
  });

  it("rejects when neither API token nor S2S credentials are provided", () => {
    expect(() =>
      parseEnvWithSchema({
        ZOOM_ADMIN_EMAIL: "admin@example.com",
        ZOOM_ADMIN_PASSWORD: "secret"
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/ZOOM_API_ACCESS_TOKEN.*ZOOM_SERVER_TO_SERVER/s);
  });

  it("accepts complete S2S credentials without access token", () => {
    const result = parseEnvWithSchema({
      ZOOM_ADMIN_EMAIL: "admin@example.com",
      ZOOM_ADMIN_PASSWORD: "secret",
      ZOOM_SERVER_TO_SERVER_ACCOUNT_ID: "acc-id",
      ZOOM_SERVER_TO_SERVER_CLIENT_ID: "client-id",
      ZOOM_SERVER_TO_SERVER_CLIENT_SECRET: "client-secret"
    } as unknown as NodeJS.ProcessEnv);
    expect(result.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID).toBe("acc-id");
    expect(result.ZOOM_API_ACCESS_TOKEN).toBeUndefined();
  });

  it("validates owner range must be paired", () => {
    expect(() =>
      parseEnvWithSchema({
        ...validEnv,
        SUB_ACCOUNT_OWNER_FROM: "user@lab-s301.example.com"
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must be configured together/);
  });

  it("rejects invalid integer values", () => {
    expect(() =>
      parseEnvWithSchema({
        ...validEnv,
        CONCURRENCY: "abc"
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/positive integer/);

    expect(() =>
      parseEnvWithSchema({
        ...validEnv,
        ACCOUNT_DELAY_MS: "-5"
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/zero or a positive integer/);
  });
});
