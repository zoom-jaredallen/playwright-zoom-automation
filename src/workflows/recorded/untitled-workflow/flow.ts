import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../automation/types.js";
import type { AppConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import type { StorageState } from "../../zoom/auth.js";
import { impersonateSubAccount } from "../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../zoom/businessAddressFlow.js";

export interface UntitledWorkflowFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  config: AppConfig;
  logger: Logger;
}

export class UntitledWorkflowFlow implements AutomationFlow {
  readonly name = "untitled-workflow";

  constructor(private readonly options: UntitledWorkflowFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const context = await this.options.browser.newContext({
      storageState: this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-untitled-workflow-${Date.now()}`
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
      // Step 1: Navigate to Contact Center - Zoom
      await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cci/index/admin#/admin-agents`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await dismissBlockingZoomPopups(page, this.options.logger);

      // Step 2: Click "+ Add user"
      await this.clickElement(page, {"role":{"role":"button","name":"Add user"},"label":"Add user","text":"+ Add user","css":"div.zcc-compat-zoom-form-item__widgets:nth-child(2) > div.edit-agent__tag.zcc-migration-user__choose-selected_tag_container > button.zcc-compat-zoom-button.zcc-compat-zoom-button--md > span.zcc-compat-zoom-button__label"}, 10000);

      // Step 3: Fill "Search by name or email address" with "chen"
      await this.fillField(page, {"role":{"role":"textbox"},"label":"Search by name or email address","css":"div.zcc-compat-zoom-dialog.zcc-migration-dialog > div.zcc-compat-zoom-dialog__body:nth-child(2) > div.zcc-compat-zoom-input.zcc-compat-zoom-input--md:nth-child(1) > input.zcc-compat-zoom-input__inner"}, "chen", 10000);

      // Step 4: Click ""
      await this.clickElement(page, {"css":"span.zcc-compat-zoom-checkbox > span.zcc-compat-zoom-checkbox__wrap > span.zcc-compat-zoom-checkbox__inner > i.zcc-compat-zoom-checkbox__knob"}, 10000);

      // Step 5: Click "Add"
      await this.clickElement(page, {"role":{"role":"button","name":"Add"},"text":"Add","css":"div.zcc-compat-zoom-overlay-dialog > div.zcc-compat-zoom-dialog.zcc-migration-dialog > div.zcc-compat-zoom-dialog__footer:nth-child(3) > button.zcc-compat-zoom-button.zcc-compat-zoom-button--md:nth-child(2)"}, 10000);

      // Step 6: Click "Select user package"
      await this.clickElement(page, {"text":"Select user package","css":"div.zcc-compat-zoom-scrollbar > div.zcc-compat-zoom-scrollbar__wrap.zcc-compat-zoom-scrollbar__wrap--hidden:nth-child(1) > div.zcc-compat-zoom-scrollbar__view > div.zcc-compat-zoom-select-input__wrapper"}, 10000);

      // Step 7: Click "Zoom Contact Center Elite (10 available)"
      await this.clickElement(page, {"role":{"role":"option","name":"Zoom Contact Center Elite (10 available)"},"label":"Zoom Contact Center Elite (10 available)","text":"Zoom Contact Center Elite (10 available)","css":"li.zcc-compat-zoom-select-option.zcc-migration-max-w-900:nth-child(3) > div.zcc-compat-zoom-select-option__content > span > span"}, 10000);

      // Step 8: Click "Save"
      await this.clickElement(page, {"role":{"role":"button","name":"Save"},"text":"Save","testId":"edit-agent-save-btn","css":"div.zcc-compat-zoom-sticky--fixed:nth-child(2) > div.edit-agent__actions > button.zcc-compat-zoom-button.zcc-compat-zoom-button--md:nth-child(1) > span.zcc-compat-zoom-button__label"}, 10000);

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
