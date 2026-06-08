/**
 * End-to-end integration test for the BusinessAddressFlow.
 * Uses a mock Zoom server to verify the full flow without hitting real Zoom.
 *
 * These tests launch a real Chromium browser via Playwright and exercise:
 * - Login and cookie capture
 * - Sub-account impersonation
 * - Business address page detection
 * - Form filling (dry run)
 *
 * Note: These tests require Playwright's Chromium to be installed.
 * Run: npm run playwright:install
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startMockZoomServer, type MockZoomServer } from "./mockZoomServer.js";
import { AutomationRunner } from "../../src/automation/runner.js";
import { createLogger } from "../../src/logger.js";
import type { AppConfig } from "../../src/config.js";
import type { ProgressAdapter, SubAccount } from "../../src/automation/types.js";
import { loginAsMasterAdmin } from "../../src/zoom/auth.js";
import { getMasterStorageState } from "../../src/zoom/masterSession.js";
import { BusinessAddressFlow } from "../../src/zoom/businessAddressFlow.js";

// Skip these tests in CI or when Playwright is not installed
const canRunBrowser = await chromium.launch({ headless: true })
  .then((b) => { b.close(); return true; })
  .catch(() => false);

const describeE2E = canRunBrowser ? describe : describe.skip;

describeE2E("BusinessAddressFlow E2E", () => {
  let mockServer: MockZoomServer;
  let browser: Browser;
  const logger = createLogger({ level: "debug", silent: true });

  beforeAll(async () => {
    mockServer = await startMockZoomServer();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await mockServer?.close();
  });

  function createTestConfig(overrides?: Partial<AppConfig>): AppConfig {
    return {
      zoom: {
        adminEmail: "admin@test.com",
        adminPassword: "test-password",
        webBaseUrl: mockServer.baseUrl,
        apiBaseUrl: `${mockServer.baseUrl}/v2`
      },
      address: {
        line1: "9 Castlereagh St",
        line2: "Level 1",
        city: "Sydney",
        state: "NSW",
        postalCode: "2000",
        country: "AU",
        customerName: "Test Customer",
        numberType: "Toll",
        contactName: "Test Contact",
        contactEmail: "contact@test.com"
      },
      documents: {
        required: false
      },
      runtime: {
        headless: true,
        dryRun: true,
        progressPath: "output/test-e2e-progress.json",
        artifactsDir: "output/test-e2e-artifacts",
        flowRetryAttempts: 1,
        flowRetryBaseDelayMs: 100,
        accountDelayMs: 0,
        concurrency: 1
      },
      ...overrides
    };
  }

  function createTestProgress(): ProgressAdapter & { history: string[] } {
    const history: string[] = [];
    return {
      history,
      shouldSkip: async () => false,
      markRunning: async (account) => { history.push(`running:${account.id}`); },
      markCompleted: async (account, msg) => { history.push(`completed:${account.id}:${msg ?? ""}`); },
      markSkipped: async (account, msg) => { history.push(`skipped:${account.id}:${msg ?? ""}`); },
      markFailed: async (account, err) => { history.push(`failed:${account.id}:${err.message}`); }
    };
  }

  it("detects an existing address and skips the account", async () => {
    const existingServer = await startMockZoomServer({ addressAlreadyExists: true });
    try {
      const config = createTestConfig({
        zoom: {
          adminEmail: "admin@test.com",
          adminPassword: "test-password",
          webBaseUrl: existingServer.baseUrl,
          apiBaseUrl: `${existingServer.baseUrl}/v2`
        }
      });

      const masterStorageState = await loginAsMasterAdmin({ browser, config: config.zoom, logger });
      const flow = new BusinessAddressFlow({ browser, masterStorageState, config, logger });
      const progress = createTestProgress();
      const accounts: SubAccount[] = [{ id: "sub-001", name: "Test Account 1" }];

      const runner = new AutomationRunner({ flow, progress });
      const summary = await runner.run(accounts);

      expect(summary.skipped).toBe(1);
      expect(summary.completed).toBe(0);
      expect(progress.history).toContain("skipped:sub-001:Address already present");
    } finally {
      await existingServer.close();
    }
  });

  it("impersonates sub accounts during the flow", async () => {
    const config = createTestConfig();
    const masterStorageState = await loginAsMasterAdmin({ browser, config: config.zoom, logger });
    const flow = new BusinessAddressFlow({ browser, masterStorageState, config, logger });
    const progress = createTestProgress();
    const accounts: SubAccount[] = [
      { id: "sub-001", name: "Test Account 1" },
      { id: "sub-002", name: "Test Account 2" }
    ];

    const runner = new AutomationRunner({ flow, progress });
    await runner.run(accounts);

    // Verify impersonation was attempted for both accounts
    expect(mockServer.impersonatedAccounts).toContain("sub-001");
    expect(mockServer.impersonatedAccounts).toContain("sub-002");
  });

  it("handles login failure gracefully", async () => {
    const failServer = await startMockZoomServer({ loginShouldFail: true });
    try {
      const config = createTestConfig({
        zoom: {
          adminEmail: "admin@test.com",
          adminPassword: "wrong-password",
          webBaseUrl: failServer.baseUrl,
          apiBaseUrl: `${failServer.baseUrl}/v2`
        }
      });

      await expect(
        loginAsMasterAdmin({ browser, config: config.zoom, logger, timeoutMs: 5_000 })
      ).rejects.toThrow();
    } finally {
      await failServer.close();
    }
  });

  it("logs in when Zoom renders a hidden password input before the visible one", async () => {
    const hiddenPasswordServer = await startMockZoomServer({ hiddenPasswordInputFirst: true });
    try {
      const config = createTestConfig({
        zoom: {
          adminEmail: "admin@test.com",
          adminPassword: "test-password",
          webBaseUrl: hiddenPasswordServer.baseUrl,
          apiBaseUrl: `${hiddenPasswordServer.baseUrl}/v2`
        }
      });

      const storageState = await loginAsMasterAdmin({ browser, config: config.zoom, logger, timeoutMs: 5_000 });

      expect(storageState.cookies.map((cookie) => cookie.name)).toContain("cred");
    } finally {
      await hiddenPasswordServer.close();
    }
  });

  it("logs in when password entry appears after a visible continuation button", async () => {
    const stagedLoginServer = await startMockZoomServer({
      passwordVisibleAfterNext: true,
      nextButtonWithoutId: true
    });
    try {
      const config = createTestConfig({
        zoom: {
          adminEmail: "admin@test.com",
          adminPassword: "test-password",
          webBaseUrl: stagedLoginServer.baseUrl,
          apiBaseUrl: `${stagedLoginServer.baseUrl}/v2`
        }
      });

      const storageState = await loginAsMasterAdmin({ browser, config: config.zoom, logger, timeoutMs: 5_000 });

      expect(storageState.cookies.map((cookie) => cookie.name)).toContain("cred");
    } finally {
      await stagedLoginServer.close();
    }
  });

  it("reuses a valid cached master storage state", async () => {
    const config = createTestConfig();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zoom-master-session-"));
    const storageStatePath = path.join(tempDir, "state.json");
    const initialSignIns = mockServer.signInSubmissionCount();

    try {
      await getMasterStorageState({
        browser,
        config: config.zoom,
        logger,
        storageStatePath,
        timeoutMs: 5_000
      });
      expect(mockServer.signInSubmissionCount()).toBe(initialSignIns + 1);

      await getMasterStorageState({
        browser,
        config: config.zoom,
        logger,
        storageStatePath,
        timeoutMs: 5_000
      });
      expect(mockServer.signInSubmissionCount()).toBe(initialSignIns + 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the full flow with concurrency > 1", async () => {
    const config = createTestConfig();
    const masterStorageState = await loginAsMasterAdmin({ browser, config: config.zoom, logger });
    const flow = new BusinessAddressFlow({ browser, masterStorageState, config, logger });
    const progress = createTestProgress();
    const accounts: SubAccount[] = [
      { id: "sub-001", name: "Test Account 1" },
      { id: "sub-002", name: "Test Account 2" }
    ];

    const runner = new AutomationRunner({ flow, progress, concurrency: 2 });
    const summary = await runner.run(accounts);

    // Both accounts should have been processed (skipped or completed depending on mock)
    expect(summary.skipped + summary.completed + summary.failed).toBe(2);
  });
});
