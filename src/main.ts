import { chromium } from "playwright";
import { filterAccountsByOwnerRange } from "./automation/accountFilters.js";
import { AutomationRunner } from "./automation/runner.js";
import { ProgressStore } from "./automation/progressStore.js";
import { loadConfigFromEnvFile } from "./config.js";
import { consoleLogger } from "./logger.js";
import { validateDocumentFiles } from "./preflight.js";
import { ZoomApiClient } from "./zoom/api.js";
import { loginAsMasterAdmin } from "./zoom/auth.js";
import { BusinessAddressFlow } from "./zoom/businessAddressFlow.js";
import { resolveZoomApiAccessToken } from "./zoom/oauth.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnvFile(process.env.ENV_PATH ?? ".env");
  if (!config.runtime.dryRun) {
    await validateDocumentFiles(config.documents);
  }

  const accessToken = await resolveZoomApiAccessToken(config.zoom);
  const apiClient = new ZoomApiClient({
    accessToken,
    baseUrl: config.zoom.apiBaseUrl
  });

  let accounts = await apiClient.listSubAccounts();
  if (config.runtime.accountIds) {
    const allowedIds = new Set(config.runtime.accountIds);
    accounts = accounts.filter((account) => allowedIds.has(account.id));
  }
  if (config.runtime.ownerRange) {
    accounts = filterAccountsByOwnerRange(accounts, config.runtime.ownerRange);
  }
  if (config.runtime.accountLimit) {
    accounts = accounts.slice(0, config.runtime.accountLimit);
  }

  consoleLogger.info("Loaded Zoom sub accounts", { count: accounts.length });
  if (accounts.length === 0) {
    consoleLogger.warn("No sub accounts matched the configured filters");
    return;
  }

  const browser = await chromium.launch({ headless: config.runtime.headless });

  try {
    const masterStorageState = await loginAsMasterAdmin({
      browser,
      config: config.zoom,
      logger: consoleLogger
    });
    const progress = new ProgressStore(config.runtime.progressPath);
    const flow = new BusinessAddressFlow({
      browser,
      masterStorageState,
      config,
      logger: consoleLogger
    });
    const runner = new AutomationRunner({
      flow,
      progress,
      retry: {
        attempts: config.runtime.flowRetryAttempts,
        baseDelayMs: config.runtime.flowRetryBaseDelayMs
      },
      accountDelayMs: config.runtime.accountDelayMs
    });
    const summary = await runner.run(accounts);

    consoleLogger.info("Automation run finished", { ...summary });
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  consoleLogger.error("Automation run failed", {
    error: normalizedError.message,
    stack: normalizedError.stack
  });
  process.exitCode = 1;
});
