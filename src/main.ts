import { chromium } from "playwright";
import { filterAccountsByOwnerRange } from "./automation/accountFilters.js";
import { AutomationRunner } from "./automation/runner.js";
import { ProgressStore } from "./automation/progressStore.js";
import { loadConfigFromEnvFile } from "./config.js";
import { createLogger, parseLogLevel } from "./logger.js";
import { validateDocumentFiles } from "./preflight.js";
import { ZoomApiClient } from "./zoom/api.js";
import { loginAsMasterAdmin } from "./zoom/auth.js";
import { BusinessAddressFlow } from "./zoom/businessAddressFlow.js";
import { TokenManager } from "./zoom/oauth.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnvFile(process.env.ENV_PATH ?? ".env");

  const runId = `run-${Date.now()}`;
  const logger = createLogger({
    level: parseLogLevel(process.env.LOG_LEVEL),
    filePath: `${config.runtime.artifactsDir}/logs/${runId}.jsonl`,
    baseMeta: { runId }
  });

  if (!config.runtime.dryRun) {
    await validateDocumentFiles(config.documents);
  }

  const tokenManager = new TokenManager(config.zoom);
  const apiClient = new ZoomApiClient({
    accessToken: tokenManager,
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

  logger.info("Loaded Zoom sub accounts", { count: accounts.length });
  if (accounts.length === 0) {
    logger.warn("No sub accounts matched the configured filters");
    return;
  }

  const browser = await chromium.launch({ headless: config.runtime.headless });

  try {
    const masterStorageState = await loginAsMasterAdmin({
      browser,
      config: config.zoom,
      logger
    });
    const progress = new ProgressStore(config.runtime.progressPath);
    const flow = new BusinessAddressFlow({
      browser,
      masterStorageState,
      config,
      logger
    });
    const cancellation = { cancelled: false };
    const shutdown = () => {
      if (!cancellation.cancelled) {
        logger.warn("Shutdown signal received, finishing current accounts...");
        cancellation.cancelled = true;
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const runner = new AutomationRunner({
      flow,
      progress,
      retry: {
        attempts: config.runtime.flowRetryAttempts,
        baseDelayMs: config.runtime.flowRetryBaseDelayMs
      },
      accountDelayMs: config.runtime.accountDelayMs,
      concurrency: config.runtime.concurrency,
      cancellation
    });
    const summary = await runner.run(accounts);

    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);

    logger.info("Automation run finished", { ...summary });
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const fallbackLogger = createLogger({ level: parseLogLevel(process.env.LOG_LEVEL) });
  fallbackLogger.error("Automation run failed", {
    error: normalizedError.message,
    stack: normalizedError.stack
  });
  process.exitCode = 1;
});
