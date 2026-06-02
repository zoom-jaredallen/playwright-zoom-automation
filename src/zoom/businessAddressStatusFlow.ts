import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../automation/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { StorageState } from "./auth.js";
import {
  dismissBlockingZoomPopups,
  findBusinessAddressStatusInPageText
} from "./businessAddressFlow.js";
import { impersonateSubAccount } from "./impersonation.js";

export interface BusinessAddressStatusFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  config: AppConfig;
  logger: Logger;
}

export class BusinessAddressStatusFlow implements AutomationFlow {
  readonly name = "zoom-business-address-status";

  constructor(private readonly options: BusinessAddressStatusFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const context = await this.options.browser.newContext({
      storageState: this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${safeFileName(input.account.id)}-status-${Date.now()}`
    );

    try {
      await mkdir(this.options.config.runtime.artifactsDir, { recursive: true });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

      await impersonateSubAccount({
        context,
        page,
        account: input.account,
        config: this.options.config.zoom,
        logger: this.options.logger
      });

      await openBusinessAddressPage(page, this.options.config);
      await dismissBlockingZoomPopups(page, this.options.logger);

      const pageText = await waitForBusinessAddressText(page, this.options.config);
      const result = findBusinessAddressStatusInPageText(pageText, this.options.config.address);
      await context.tracing.stop();

      if (!result.present) {
        this.options.logger.warn("Configured business address was not found", { accountId: input.account.id });
        return { status: "completed", message: "Address not found" };
      }

      const verificationStatus = result.verificationStatus ?? "Unknown";
      this.options.logger.info("Configured business address status detected", {
        accountId: input.account.id,
        verificationStatus
      });
      return { status: "completed", message: `Address status: ${verificationStatus}` };
    } catch (error) {
      await page.screenshot({ path: `${artifactBase}-failure.png`, fullPage: true }).catch(() => undefined);
      await writeFailureDetails(page, `${artifactBase}-failure.json`, error).catch(() => undefined);
      await context.tracing.stop({ path: `${artifactBase}-trace.zip` }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }
}

async function openBusinessAddressPage(page: Page, config: AppConfig): Promise<void> {
  const url = `${config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/business-address`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

  if (page.url().includes("/signin")) {
    throw new Error("Zoom redirected to sign-in while opening the business address page");
  }
}

async function waitForBusinessAddressText(page: Page, config: AppConfig): Promise<string> {
  const deadline = Date.now() + 30_000;
  let latestText = "";

  while (Date.now() < deadline) {
    latestText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const result = findBusinessAddressStatusInPageText(latestText, config.address);
    if (result.present) {
      return latestText;
    }
    await page.waitForTimeout(1_000);
  }

  return latestText;
}

async function writeFailureDetails(page: Page, artifactPath: string, error: unknown): Promise<void> {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const details = {
    timestamp: new Date().toISOString(),
    url: page.url(),
    title: await page.title().catch(() => ""),
    error: {
      name: normalizedError.name,
      message: normalizedError.message,
      stack: normalizedError.stack
    },
    visibleTextSample: bodyText.slice(0, 12_000)
  };

  await writeFile(artifactPath, `${JSON.stringify(details, null, 2)}\n`, "utf8");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "_");
}
