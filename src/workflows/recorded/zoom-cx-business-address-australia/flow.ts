import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../automation/types.js";
import type { AppConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import type { StorageState } from "../../zoom/auth.js";
import { impersonateSubAccount } from "../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../zoom/businessAddressFlow.js";

export interface ZoomCxBusinessAddressAustraliaFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  config: AppConfig;
  logger: Logger;
}

export class ZoomCxBusinessAddressAustraliaFlow implements AutomationFlow {
  readonly name = "zoom-cx-business-address-australia";

  constructor(private readonly options: ZoomCxBusinessAddressAustraliaFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const context = await this.options.browser.newContext({
      storageState: this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-zoom-cx-business-address-australia-${Date.now()}`
    );

    try {
      await mkdir(this.options.config.runtime.artifactsDir, { recursive: true });
      await context.tracing.start({ screenshots: true, snapshots: true });

      // Impersonate sub-account
      await impersonateSubAccount({
        context,
        page,
        account: input.account,
        config: this.options.config.zoom,
        logger: this.options.logger
      });

      await dismissBlockingZoomPopups(page, this.options.logger);

    // Assertions are checked inline after their triggering actions

      // ─── Recorded Actions ────────────────────────────────────────────
      // Step 1: Navigate to Business Address & Documents - Zoom
      await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await dismissBlockingZoomPopups(page, this.options.logger);

      await context.tracing.stop();
      return { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: `${artifactBase}-failure.png`, fullPage: true }).catch(() => undefined);
      await context.tracing.stop({ path: `${artifactBase}-trace.zip` }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private resolve(paramName: string): string {
    const config = this.options.config;
    const addressMap: Record<string, string | undefined> = {
      "address.line1": config.address.line1,
      "address.line2": config.address.line2,
      "address.city": config.address.city,
      "address.state": config.address.state,
      "address.postalCode": config.address.postalCode,
      "address.country": config.address.country,
      "customerName": config.address.customerName,
      "contact.name": config.address.contactName,
      "contact.number": config.address.contactNumber,
      "contact.email": config.address.contactEmail,
      "contactEmail": config.address.contactEmail
    };
    const value = addressMap[paramName];
    if (!value) {
      throw new Error(`Parameter "${paramName}" could not be resolved from config`);
    }
    return value;
  }

  private resolveValue(template: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, paramName) => this.resolve(paramName.trim()));
  }
}
