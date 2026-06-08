import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../../automation/types.js";
import type { AppConfig } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import type { StorageState } from "../../../zoom/auth.js";
import { impersonateSubAccount } from "../../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../../zoom/popups.js";
import { resolveSelector } from "../../../runtime/selectors/selectorResolver.js";

interface PhoneNumberListSearchResult {
  applied: boolean;
  matchedNumbers: string[];
  visibleRowCount: number;
}

export interface AddZoomPhoneSydneyNumbersFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  getMasterStorageState?: () => StorageState;
  config: AppConfig;
  logger: Logger;
}

export class AddZoomPhoneSydneyNumbersFlow implements AutomationFlow {
  readonly name = "add-zoom-phone-sydney-numbers";

  constructor(private readonly options: AddZoomPhoneSydneyNumbersFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const activeAccountId = input.account.id;
    let dryRunSkipped = false;
    let completedByTargetState = false;
    let requiredSydneyNumbersToAdd = 4;
    const workflowState = new Map<string, string[]>();
    const context = await this.options.browser.newContext({
      storageState: this.options.getMasterStorageState?.() ?? this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-add-zoom-phone-sydney-numbers-${Date.now()}`
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
      // Step 1: Navigate to Phone Numbers - Zoom
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Navigate to Phone Numbers - Zoom" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Navigate to Phone Numbers - Zoom", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/number-list?pageNumber=1&pageSize=15`, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        await dismissBlockingZoomPopups(page, this.options.logger);
          });
      // Auto verification (urlContains)
        await page.waitForURL((url) => url.href.includes("#/number-list?pageNumber=1&pageSize=15"), { timeout: 15000 });
        }
      }

      // Step 2: Expand "Add Number"
      {
        const existingSydneyNumbers = await this.countExistingSydneyPhoneNumbers(page);
        if (existingSydneyNumbers >= 4) {
          this.options.logger.info("Sydney phone numbers already present; skipping account", {
            minimumCount: 4,
            existingSydneyNumbers,
            prefix: "+612"
          });
          return { status: "skipped", message: "At least 4 Sydney +612 phone numbers already present" };
        }
        requiredSydneyNumbersToAdd = Math.max(1, 4 - existingSydneyNumbers);
        this.options.logger.info("Sydney phone-number top-up required", {
          existingSydneyNumbers,
          requiredSydneyNumbersToAdd
        });
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"button","name":"Add Number"},"text":"Add Number","css":"#wizard-number-btn > span"});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Expand \"Add Number\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Expand \"Add Number\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.clickElement(page, {"role":{"role":"button","name":"Add Number"},"text":"Add Number","css":"#wizard-number-btn > span"}, [{"id":"role-button-add-number","kind":"role","selector":{"role":{"role":"button","name":"Add Number"}},"source":"recorded","label":"button Add Number","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<button \"Add Number\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-wizard-number-btn-span","kind":"css","selector":{"css":"#wizard-number-btn > span"},"source":"recorded","label":"#wizard-number-btn > span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Add Number\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-add-number","kind":"text","selector":{"text":"Add Number"},"source":"recorded","label":"Add Number","diagnostics":{"matchedCount":17,"visibleCount":17,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-span-button-span","kind":"xpath","selector":{"xpath":"//div[1]/span/button/span"},"source":"recorded","label":"//div[1]/span/button/span","diagnostics":{"matchedCount":20,"visibleCount":20,"chosenPreview":"<span>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], 10000, undefined, {"expanded":true});
          });
        }
      }

      // Step 3: Click "Get Number"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"menuitem"},"text":"Get Number","css":"#wizard-get-number-2","nth":112});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Get Number\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Click \"Get Number\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.openGetNumberWizard(page, 10000);
          });
        }
      }

      // Step 4: Select "Phone" in Product
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Product"},"anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Phone\" in Product" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Phone\" in Product", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectZoomFormOption(page, "Product", "Phone", 10000);
          });
        }
      }

      // Step 5: Select "Australia" in Country/Region
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Australia\" in Country/Region" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Australia\" in Country/Region", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}}, [{"id":"role-combobox-country-region","kind":"role","selector":{"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-country-region","kind":"label","selector":{"label":"Country/Region","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], this.resolveValue("{{address.country}}", activeAccountId), 10000, undefined, {"targetCandidates":[{"id":"role-combobox-country-region","kind":"role","selector":{"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-country-region","kind":"label","selector":{"label":"Country/Region","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionCandidates":[{"id":"testId-virtualfilterselectoptionuniquekey-au","kind":"testId","selector":{"testId":"__VirtualFilterSelectOptionUniqueKey__AU"},"source":"recorded","label":"__VirtualFilterSelectOptionUniqueKey__AU","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"Australia\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"role-option-australia","kind":"role","selector":{"role":{"role":"option","name":"Australia","exact":true}},"source":"generated","label":"option Australia","diagnostics":{"matchedCount":2,"visibleCount":2,"chosenPreview":"<div \"Australia\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"css-div-div-div-cpzui-virtual-filter-select-option-nth-child-4-div","kind":"css","selector":{"css":"div > div > div.cpzui-virtual-filter-select-option:nth-child(4) > div"},"source":"recorded","label":"div > div > div.cpzui-virtual-filter-select-option:nth-child(4) > div","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"Australia\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-australia","kind":"text","selector":{"text":"Australia"},"source":"recorded","label":"Australia","diagnostics":{"matchedCount":10,"visibleCount":10,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-div-div-4-div","kind":"xpath","selector":{"xpath":"//div/div/div[4]/div"},"source":"recorded","label":"//div/div/div[4]/div","diagnostics":{"matchedCount":7,"visibleCount":7,"chosenPreview":"<div \"Support\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionLabel":"Australia","verificationText":"Australia"});
          });
        }
      }

      // Step 6: Select "New South Wales (NSW)" in State/Province/Territory
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"State/Province/Territory"},"anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"New South Wales (NSW)\" in State/Province/Territory" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"New South Wales (NSW)\" in State/Province/Territory", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"State/Province/Territory"},"anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}}, [{"id":"role-combobox-state-province-territory","kind":"role","selector":{"role":{"role":"combobox","name":"State/Province/Territory"},"anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-state-province-territory","kind":"label","selector":{"label":"State/Province/Territory","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], this.resolveValue("{{address.state}}", activeAccountId), 10000, undefined, {"targetCandidates":[{"id":"role-combobox-state-province-territory","kind":"role","selector":{"role":{"role":"combobox","name":"State/Province/Territory"},"anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-state-province-territory","kind":"label","selector":{"label":"State/Province/Territory","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionCandidates":[{"id":"testId-virtualfilterselectoptionuniquekey-65","kind":"testId","selector":{"testId":"__VirtualFilterSelectOptionUniqueKey__65"},"source":"recorded","label":"__VirtualFilterSelectOptionUniqueKey__65","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"New South Wales (NSW)\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"role-option-new-south-wales-nsw","kind":"role","selector":{"role":{"role":"option","name":"New South Wales (NSW)","exact":true}},"source":"generated","label":"option New South Wales (NSW)","diagnostics":{"matchedCount":2,"visibleCount":2,"chosenPreview":"<div \"New South Wales (NSW)\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"css-div-div-div-cpzui-virtual-filter-select-option-div","kind":"css","selector":{"css":"div > div > div.cpzui-virtual-filter-select-option > div"},"source":"recorded","label":"div > div > div.cpzui-virtual-filter-select-option > div","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"New South Wales (NSW)\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-new-south-wales-nsw","kind":"text","selector":{"text":"New South Wales (NSW)"},"source":"recorded","label":"New South Wales (NSW)","diagnostics":{"matchedCount":10,"visibleCount":10,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-div-div-div","kind":"xpath","selector":{"xpath":"//div/div/div/div"},"source":"recorded","label":"//div/div/div/div","diagnostics":{"matchedCount":214,"visibleCount":206,"chosenPreview":"<div \"Search Support 61.1800.768.027 Contact Sales Request a Demo Toggle navigation Jo\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionLabel":"New South Wales (NSW)","verificationText":"New South Wales (NSW)"});
          });
        }
      }

      // Step 7: Filter Area Code - City with Sydney
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Area Code - City"},"label":"Area Code - City","css":"div:nth-child(1) > div > div > input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Filter Area Code - City with Sydney" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Filter Area Code - City with Sydney", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"combobox","name":"Area Code - City"},"label":"Area Code - City","css":"div:nth-child(1) > div > div > input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}}, [{"id":"role-combobox-area-code-city","kind":"role","selector":{"role":{"role":"combobox","name":"Area Code - City"},"anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-area-code-city","kind":"label","selector":{"label":"Area Code - City","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], this.resolveValue("{{address.city}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 8: Select "Sydney - , New South Wales" in Area Code - City
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Area Code - City"},"anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Sydney - , New South Wales\" in Area Code - City" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Sydney - , New South Wales\" in Area Code - City", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Area Code - City"},"anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}}, [{"id":"role-combobox-area-code-city","kind":"role","selector":{"role":{"role":"combobox","name":"Area Code - City"},"anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-area-code-city","kind":"label","selector":{"label":"Area Code - City","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], this.resolveValue("{{address.city}}", activeAccountId), 10000, undefined, {"targetCandidates":[{"id":"role-combobox-area-code-city","kind":"role","selector":{"role":{"role":"combobox","name":"Area Code - City"},"anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"label-area-code-city","kind":"label","selector":{"label":"Area Code - City","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Area Code - City","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Area Code - City","scopeSelector":".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":12,"visibleCount":12,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionCandidates":[{"id":"testId-virtualfilterselectoptionuniquekey-9444","kind":"testId","selector":{"testId":"__VirtualFilterSelectOptionUniqueKey__9444"},"source":"recorded","label":"__VirtualFilterSelectOptionUniqueKey__9444","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"Sydney , New South Wales\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"role-option-sydney-new-south-wales","kind":"role","selector":{"role":{"role":"option","name":"Sydney - , New South Wales","exact":true}},"source":"generated","label":"option Sydney - , New South Wales","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"css-div-div-div-cpzui-virtual-filter-select-option-div","kind":"css","selector":{"css":"div > div > div.cpzui-virtual-filter-select-option > div"},"source":"recorded","label":"div > div > div.cpzui-virtual-filter-select-option > div","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"Sydney , New South Wales\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-sydney-new-south-wales","kind":"text","selector":{"text":"Sydney , New South Wales"},"source":"recorded","label":"Sydney , New South Wales","diagnostics":{"matchedCount":11,"visibleCount":11,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-div-div-div","kind":"xpath","selector":{"xpath":"//div/div/div/div"},"source":"recorded","label":"//div/div/div/div","diagnostics":{"matchedCount":215,"visibleCount":207,"chosenPreview":"<div \"Search Support 61.1800.768.027 Contact Sales Request a Demo Toggle navigation Jo\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionLabel":"Sydney - , New South Wales","verificationText":"Sydney - , New South Wales"});
          });
        }
      }

      // Step 9: Click "Search"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"button","name":"Search"},"text":"Search","css":"div:nth-child(7) > div:nth-child(1) > button.cpzui-button.cpzui-button--md > span","nth":3});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Search\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Click \"Search\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.clickElement(page, {"role":{"role":"button","name":"Search"},"text":"Search","css":"div:nth-child(7) > div:nth-child(1) > button.cpzui-button.cpzui-button--md > span","nth":3}, [{"id":"role-button-search","kind":"role","selector":{"role":{"role":"button","name":"Search"}},"source":"recorded","label":"button Search","diagnostics":{"matchedCount":4,"visibleCount":4,"chosenPreview":"<div \"Search\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"css-div-nth-child-7-div-nth-child-1-button-cpzui-button-cpzui-button","kind":"css","selector":{"css":"div:nth-child(7) > div:nth-child(1) > button.cpzui-button.cpzui-button--md > span"},"source":"recorded","label":"div:nth-child(7) > div:nth-child(1) > button.cpzui-button.cpzui-button--md > span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Search\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"xpath-div-7-div-1-button-span","kind":"xpath","selector":{"xpath":"//div[7]/div[1]/button/span"},"source":"recorded","label":"//div[7]/div[1]/button/span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Search\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-search","kind":"text","selector":{"text":"Search"},"source":"recorded","label":"Search","diagnostics":{"matchedCount":65,"visibleCount":65,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], 10000, undefined);
          });
        }
      }

      // Step 10: Select first 4 available phone-number rows
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select first 4 available phone-number rows" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select first 4 available phone-number rows", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectRows(page, {"mode":"firstAvailable","count":requiredSydneyNumbersToAdd,"minimumCount":requiredSydneyNumbersToAdd,"entityKind":"phoneNumber","outputName":"selected.phoneNumbers","rowSelector":"tr, [role='row'], .zcc-compat-zoom-virtual-table__row, .zcc-compat-zoom-table__row, .zcc-compat-zoom-table-row, .zcc-compat-zoom-table__body-row","checkboxSelector":"[role='checkbox'], input[type='checkbox'], [class*='checkbox'], [class*='Checkbox'], [class*='cpzui-checkbox']","valuePattern":"\\+\\d[\\d\\s().-]{5,}","unavailableText":"Unavailable|Reserved|Assigned|In use|Unavailable"}, 10000, workflowState);
          });
        }
      }

      // Step 11: Click "Continue"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"button","name":"Continue"},"text":"Continue","css":"div > button.cpzui-button.cpzui-button--md:nth-child(2) > span > span"});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Continue\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Click \"Continue\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":true,"readyTimeoutMs":10000}, async () => {
        const __networkWait = page.waitForResponse((response) => response.url().includes("/cp/webapi/business-address/list-address"), { timeout: 10000 }).catch(() => undefined);
        await this.clickElement(page, {"role":{"role":"button","name":"Continue"},"text":"Continue","css":"div > button.cpzui-button.cpzui-button--md:nth-child(2) > span > span"}, [{"id":"role-button-continue","kind":"role","selector":{"role":{"role":"button","name":"Continue"}},"source":"recorded","label":"button Continue","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<button \"Continue\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-button-cpzui-button-cpzui-button-md-nth-child-2-span-span","kind":"css","selector":{"css":"div > button.cpzui-button.cpzui-button--md:nth-child(2) > span > span"},"source":"recorded","label":"div > button.cpzui-button.cpzui-button--md:nth-child(2) > span > span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Continue\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"xpath-div-button-2-span-span","kind":"xpath","selector":{"xpath":"//div/button[2]/span/span"},"source":"recorded","label":"//div/button[2]/span/span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Continue\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-continue","kind":"text","selector":{"text":"Continue"},"source":"recorded","label":"Continue","diagnostics":{"matchedCount":22,"visibleCount":22,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], 10000, undefined);
        await __networkWait;
          });
        }
      }

      // Step 12: Select "9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia" in Business Address & Documents
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Business Address & Documents"},"anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia\" in Business Address & Documents" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia\" in Business Address & Documents", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Business Address & Documents"},"anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}}, [{"id":"role-combobox-business-address-documents","kind":"role","selector":{"role":{"role":"combobox","name":"Business Address & Documents"},"anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Business Address & Documents","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1}}},{"id":"label-business-address-documents","kind":"label","selector":{"label":"Business Address & Documents","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Business Address & Documents","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1}}},{"id":"css-div-nth-child-1-span-cpzui-virtual-filter-select-cpzui-virtual-f","kind":"css","selector":{"css":"div:nth-child(1) > span.cpzui-virtual-filter-select.cpzui-virtual-filter-select--md > div.cpzui-virtual-filter-select-input.cpzui-virtual-filter-select-input--md > i.cpzui-icon.cpzui-inline-chevron-icon","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > span.cpzui-virtual-filter-select.cpzui-virtual-filter-select--md > div.cpzui-virtual-filter-select-input.cpzui-virtual-filter-select-input--md > i.cpzui-icon.cpzui-inline-chevron-icon","diagnostics":{"matchedCount":1,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":1,"directVisibleCount":0,"contextMatchedCount":1,"contextVisibleCount":0}}},{"id":"xpath-div-1-span-div-i","kind":"xpath","selector":{"xpath":"//div[1]/span/div/i","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/span/div/i","diagnostics":{"matchedCount":1,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":1,"directVisibleCount":0,"contextMatchedCount":1,"contextVisibleCount":0}}}], this.resolveValue("{{address.line1}}", activeAccountId), 10000, undefined, {"targetCandidates":[{"id":"role-combobox-business-address-documents","kind":"role","selector":{"role":{"role":"combobox","name":"Business Address & Documents"},"anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"combobox Business Address & Documents","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1}}},{"id":"label-business-address-documents","kind":"label","selector":{"label":"Business Address & Documents","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"Business Address & Documents","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<input>","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1}}},{"id":"css-div-nth-child-1-span-cpzui-virtual-filter-select-cpzui-virtual-f","kind":"css","selector":{"css":"div:nth-child(1) > span.cpzui-virtual-filter-select.cpzui-virtual-filter-select--md > div.cpzui-virtual-filter-select-input.cpzui-virtual-filter-select-input--md > i.cpzui-icon.cpzui-inline-chevron-icon","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"div:nth-child(1) > span.cpzui-virtual-filter-select.cpzui-virtual-filter-select--md > div.cpzui-virtual-filter-select-input.cpzui-virtual-filter-select-input--md > i.cpzui-icon.cpzui-inline-chevron-icon","diagnostics":{"matchedCount":1,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":1,"directVisibleCount":0,"contextMatchedCount":1,"contextVisibleCount":0}}},{"id":"xpath-div-1-span-div-i","kind":"xpath","selector":{"xpath":"//div[1]/span/div/i","anchor":{"text":"Business Address & Documents","scopeSelector":".cpzui-form-item__row","kind":"formField","relationship":"nearControl"}},"source":"recorded","label":"//div[1]/span/div/i","diagnostics":{"matchedCount":1,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":1,"directVisibleCount":0,"contextMatchedCount":1,"contextVisibleCount":0}}}],"optionCandidates":[{"id":"role-option-9-castlereagh-st-level-1sydney-nsw-2000-australia","kind":"role","selector":{"role":{"role":"option","name":"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia","exact":true}},"source":"recorded","label":"option 9 Castlereagh St, Level 1Sydney, NSW 2000, Australia","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"testId-virtualfilterselectoptionuniquekey-rmqonpxktcg0ri8ybuesbq","kind":"testId","selector":{"testId":"__VirtualFilterSelectOptionUniqueKey__rmQOnpxkTCG0Ri8ybUeSBQ"},"source":"recorded","label":"__VirtualFilterSelectOptionUniqueKey__rmQOnpxkTCG0Ri8ybUeSBQ","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"role-option-9-castlereagh-st-level-1-sydney-nsw-2000-australia","kind":"role","selector":{"role":{"role":"option","name":"9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia","exact":true}},"source":"generated","label":"option 9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"css-div-div-div-cpzui-virtual-filter-select-option-div","kind":"css","selector":{"css":"div > div > div.cpzui-virtual-filter-select-option > div"},"source":"recorded","label":"div > div > div.cpzui-virtual-filter-select-option > div","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<div \"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-9-castlereagh-st-level-1sydney-nsw-2000-australia","kind":"text","selector":{"text":"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia"},"source":"recorded","label":"9 Castlereagh St, Level 1Sydney, NSW 2000, Australia","diagnostics":{"matchedCount":10,"visibleCount":10,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"xpath-div-div-div-div","kind":"xpath","selector":{"xpath":"//div/div/div/div"},"source":"recorded","label":"//div/div/div/div","diagnostics":{"matchedCount":165,"visibleCount":162,"chosenPreview":"<div \"Search Support 61.1800.768.027 Contact Sales Request a Demo Toggle navigation Jo\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}],"optionLabel":"9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia","verificationText":"9 Castlereagh St, Level 1 - Sydney, NSW 2000, Australia"});
          });
        }
      }

      // Step 13: Click "Done"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"button","name":"Done"},"text":"Done","css":"div > button.cpzui-button.cpzui-button--md:nth-child(3) > span > span"});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Done\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Click \"Done\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":true,"readyTimeoutMs":10000}, async () => {
        await this.clickElement(page, {"role":{"role":"button","name":"Done"},"text":"Done","css":"div > button.cpzui-button.cpzui-button--md:nth-child(3) > span > span"}, [{"id":"role-button-done","kind":"role","selector":{"role":{"role":"button","name":"Done"}},"source":"recorded","label":"button Done","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<button \"Done\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"css-div-button-cpzui-button-cpzui-button-md-nth-child-3-span-span","kind":"css","selector":{"css":"div > button.cpzui-button.cpzui-button--md:nth-child(3) > span > span"},"source":"recorded","label":"div > button.cpzui-button.cpzui-button--md:nth-child(3) > span > span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Done\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"xpath-div-button-3-span-span","kind":"xpath","selector":{"xpath":"//div/button[3]/span/span"},"source":"recorded","label":"//div/button[3]/span/span","diagnostics":{"matchedCount":1,"visibleCount":1,"chosenPreview":"<span \"Done\">","uniquelyIdentifiesTarget":true,"anchorReducedMatches":false}},{"id":"text-done","kind":"text","selector":{"text":"Done"},"source":"recorded","label":"Done","diagnostics":{"matchedCount":36,"visibleCount":36,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">","uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], 10000, undefined);
          });
      // Auto verification (entityExists)
      try {
        await this.expectEntityPresence(page, this.resolveExpected("{{selected.phoneNumbers}}", workflowState), true, 15000);
      } catch (error) {
        const hadPartialFailureDialog = await this.closePartialPurchaseFailureDialog(page);
        if (await this.verifyTargetSydneyNumberCount(page)) {
          completedByTargetState = true;
          this.options.logger.info("Workflow completed by target-state verification", {
            hadPartialFailureDialog
          });
          return;
        }
        const retryableError = new Error(
          hadPartialFailureDialog
            ? "Partial number purchase left account below the target Sydney number count; retry required"
            : "Could not verify target Sydney number count after purchase; retry required"
        );
        Object.assign(retryableError, { retryable: true });
        throw retryableError;
      }
        }
      }

      await context.tracing.stop();
      return dryRunSkipped
        ? { status: "skipped", message: "Dry run: mutating steps were not submitted" }
        : completedByTargetState
          ? { status: "completed", message: "Target Sydney phone-number count satisfied" }
        : { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: `${artifactBase}-failure.png`, fullPage: true }).catch(() => undefined);
      await context.tracing.stop({ path: `${artifactBase}-trace.zip` }).catch(() => undefined);
      await this.writeSelectorDiagnostics(artifactBase, error).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private resolve(paramName: string, activeAccountId?: string): string {
    const config = this.options.config;
    // Per-account value (e.g. a distinct user per sub-account) takes precedence.
    const perAccount = activeAccountId ? config.accountValues?.[activeAccountId]?.[paramName] : undefined;
    if (perAccount !== undefined && perAccount !== "") {
      return perAccount;
    }
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

  private resolveValue(template: string, activeAccountId?: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, paramName) => this.resolve(paramName.trim(), activeAccountId));
  }

  private resolveExpected(template: string, workflowState: Map<string, string[]>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, rawName) => {
      const name = String(rawName).trim();
      const values = workflowState.get(name);
      if (values) return values.join("|");
      return this.resolve(name);
    });
  }

  private async selectRows(page: Page, policy: Record<string, any>, timeout: number, workflowState: Map<string, string[]>): Promise<void> {
    if (policy.mode !== "firstAvailable") {
      throw new Error(`Unsupported row selection mode: ${policy.mode}`);
    }
    const count = Math.max(1, Number(policy.count ?? 1));
    const minimumCount = Math.max(1, Number(policy.minimumCount ?? count));
    const rowSelector = policy.rowSelector ?? "tr, [role='row']";
    const checkboxSelector = policy.checkboxSelector ?? "[role='checkbox'], input[type='checkbox']";
    const valuePattern = new RegExp(policy.valuePattern ?? "\\+\\d[\\d\\s().-]{5,}");
    const unavailablePattern = policy.unavailableText ? new RegExp(policy.unavailableText, "i") : undefined;
    const selectedValues: string[] = [];
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline && selectedValues.length < count) {
      const rows = page.locator(rowSelector);
      const rowCount = await rows.count().catch(() => 0);
      for (let index = 0; index < rowCount && selectedValues.length < count; index++) {
        const row = rows.nth(index);
        if (!await row.isVisible({ timeout: 250 }).catch(() => false)) continue;
        const rowText = await row.innerText({ timeout: 500 }).catch(() => "");
        if (unavailablePattern?.test(rowText)) continue;
        const value = rowText.match(valuePattern)?.[0]?.replace(/\s+/g, " ").trim();
        if (!value || selectedValues.includes(value)) continue;
        const checkbox = await this.findRowCheckbox(row, checkboxSelector);
        if (!await checkbox.isVisible({ timeout: 250 }).catch(() => false)) continue;
        const disabled = await checkbox.getAttribute("aria-disabled").catch(() => null)
          ?? await checkbox.getAttribute("disabled").catch(() => null);
        if (disabled === "true" || disabled === "") continue;
        if (!await this.isCheckboxChecked(checkbox)) {
          await this.ensureCheckboxChecked(checkbox, timeout);
        }
        if (!await this.isCheckboxChecked(checkbox)) continue;
        selectedValues.push(value);
      }
      if (selectedValues.length < count) await page.waitForTimeout(500);
    }

    if (selectedValues.length < minimumCount) {
      throw new Error(`Expected at least ${minimumCount} available row(s), found ${selectedValues.length}`);
    }
    const outputName = policy.outputName ?? "selected.rows";
    workflowState.set(outputName, selectedValues);
    this.options.logger.info("Selected dynamic rows", { outputName, selectedValues });
  }

  private async findRowCheckbox(row: import("playwright").Locator, checkboxSelector: string): Promise<import("playwright").Locator> {
    const role = row.locator("[role='checkbox']").first();
    if (await role.isVisible({ timeout: 250 }).catch(() => false)) return role;

    const cpzui = row.locator(".cpzui-checkbox, [class*='cpzui-checkbox']").first();
    if (await cpzui.isVisible({ timeout: 250 }).catch(() => false)) return cpzui;

    const native = row.locator("input[type='checkbox']").first();
    if (await native.isVisible({ timeout: 250 }).catch(() => false)) return native;

    return row.locator(checkboxSelector).first();
  }

  private async ensureCheckboxChecked(checkbox: import("playwright").Locator, timeout: number): Promise<void> {
    await checkbox.check({ timeout }).catch(async () => {
      await checkbox.click({ timeout }).catch(async () => {
        await checkbox.click({ timeout: Math.min(timeout, 3_000), force: true });
      });
    });
    await this.waitForCheckboxChecked(checkbox, Math.min(timeout, 3_000));
  }

  private async waitForCheckboxChecked(checkbox: import("playwright").Locator, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isCheckboxChecked(checkbox)) return;
      await checkbox.page().waitForTimeout(100);
    }
  }

  private async isCheckboxChecked(checkbox: import("playwright").Locator): Promise<boolean> {
    const inputChecked = await checkbox.evaluate((node) => {
      if (node instanceof HTMLInputElement) return node.checked;
      const descendant = node.querySelector("input[type='checkbox']");
      return descendant instanceof HTMLInputElement ? descendant.checked : false;
    }).catch(() => false);
    if (inputChecked) return true;

    const attr = await checkbox.getAttribute("aria-checked").catch(() => null);
    if (attr === "true") return true;

    return await checkbox.evaluate((node) =>
      Boolean(node.closest("[aria-checked='true'], .is-checked, [class*='is-checked']"))
    ).catch(() => false);
  }


  private healingReport: Array<{ actionDescription: string; originalStrategy: string; healedStrategy: string; confidence: number }> = [];

  private async writeSelectorDiagnostics(artifactBase: string, error?: unknown): Promise<void> {
    const payload = {
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error ?? "") },
      healingReport: this.healingReport
    };
    await writeFile(`${artifactBase}-selector-diagnostics.json`, JSON.stringify(payload, null, 2), "utf8");
  }

  /** Feature 1: resolve element queries against an iframe when a frame selector was recorded. */
  private scope(page: Page, frameSelector?: string): import("playwright").Page | import("playwright").FrameLocator {
    return frameSelector ? page.frameLocator(frameSelector) : page;
  }

  private async findAnchoredCheckbox(root: import("playwright").Page | import("playwright").FrameLocator, selectors: Record<string, any>, esc: (value: string) => string, timeout: number): Promise<import("playwright").Locator | undefined> {
    if (selectors.role?.role !== "checkbox" || !selectors.anchor?.text) return undefined;

    const anchorText = new RegExp(esc(selectors.anchor.text), "i");
    const rowSelector = [
      "tr",
      "[role='row']",
      ".zcc-compat-zoom-virtual-table__row",
      ".zcc-compat-zoom-table__row",
      ".zcc-compat-zoom-table-row",
      ".zcc-compat-zoom-table__body-row"
    ].join(", ");
    const checkboxSelector = [
      "[role='checkbox']",
      ".zcc-compat-zoom-checkbox__wrap",
      ".zcc-compat-zoom-checkbox",
      ".zcc-compat-zoom-checkbox__inner",
      "input[type='checkbox']"
    ].join(", ");
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const remaining = Math.max(250, deadline - Date.now());
      const visibleDialog = root.getByRole("dialog").last();
      const rowCandidates = [
        visibleDialog.locator(rowSelector).filter({ hasText: anchorText }).first(),
        root.locator(rowSelector).filter({ hasText: anchorText }).first()
      ];

      for (const row of rowCandidates) {
        try {
          await row.waitFor({ state: "visible", timeout: Math.min(remaining, 750) });
          const roleCheckbox = row.getByRole("checkbox").first();
          if (await roleCheckbox.isVisible({ timeout: 250 }).catch(() => false)) {
            return roleCheckbox;
          }
          const wrapper = row.locator(checkboxSelector).first();
          if (await wrapper.isVisible({ timeout: 250 }).catch(() => false)) {
            return wrapper;
          }
        } catch { /* try the next candidate */ }
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return undefined;
  }

  private resolveAnchorScope(root: import("playwright").Page | import("playwright").FrameLocator, selectors: Record<string, any>, esc: (value: string) => string): any {
    const anchor = selectors.anchor;
    if (!anchor || (!anchor.text && !anchor.scopeRole && !anchor.scopeSelector)) return root;

    const anchorText = anchor.text ? new RegExp(esc(anchor.text), "i") : undefined;
    let container: any;
    if (anchor.scopeSelector) {
      container = root.locator(anchor.scopeSelector);
    } else if (anchor.scopeRole) {
      container = root.getByRole(anchor.scopeRole);
    } else {
      container = root.getByRole("row");
    }
    if (anchorText) {
      container = container.filter({ hasText: anchorText });
    }
    const scoped = container.first();

    // "near"/directional anchors still resolve inside the nearest stable container
    // for now; preserving the relationship lets future layout-aware locators refine it.
    if (anchor.relationship && anchor.relationship !== "within") {
      this.options.logger.info("Using relationship anchor scope", { relationship: anchor.relationship, anchor: anchor.text });
    }
    return scoped;
  }

  private async findElement(root: import("playwright").Page | import("playwright").FrameLocator, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, timeout: number): Promise<import("playwright").Locator> {
    const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Anchors: scope to a container (e.g. the row whose Name contains "michael.chen")
    // before resolving the normal strategies. "within" is the primary path; other
    // relationships approximate by scoping to the same container.
    let scope: any = this.resolveAnchorScope(root, selectors, esc);

    // When an ordinal was recorded, target that match; otherwise the first.
    const strategies = this.buildSelectorStrategies(scope, selectors, selectorCandidates, esc);

    const anchoredCheckbox = await this.findAnchoredCheckbox(root, selectors, esc, timeout);
    if (anchoredCheckbox) {
      this.healingReport.push({ actionDescription: "", originalStrategy: "role:checkbox", healedStrategy: "anchored-checkbox", confidence: 0.9 });
      this.options.logger.warn("Selector healed", { original: "role:checkbox", healed: "anchored-checkbox" });
      return anchoredCheckbox;
    }

    try {
      const resolved = await resolveSelector(root as any, selectors as any, selectorCandidates as any, timeout);
      const selectorDiagnostics = resolved.diagnostics;
      if (selectorDiagnostics.fallbackUsed) {
        this.healingReport.push({
          actionDescription: "",
          originalStrategy: selectorDiagnostics.requestedStrategies[0] ?? "unknown",
          healedStrategy: selectorDiagnostics.selectedStrategy ?? "unknown",
          confidence: selectorDiagnostics.confidence === "high" ? 0.95 : selectorDiagnostics.confidence === "medium" ? 0.7 : 0.4
        });
        this.options.logger.warn("Selector healed", { selectorDiagnostics });
      } else {
        this.options.logger.info("Selector resolved", { selectorDiagnostics });
      }
      return resolved.locator;
    } catch (runtimeError) {
      this.options.logger.warn("Ranked selector resolver failed; using legacy selector healing", {
        error: runtimeError instanceof Error ? runtimeError.message : String(runtimeError)
      });
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const remaining = Math.max(250, deadline - Date.now());
      for (const strategy of strategies) {
        try {
          const el = strategy.locator();
          await el.waitFor({ state: "visible", timeout: Math.min(remaining, 750) });
          if (strategy !== strategies[0]) {
            this.healingReport.push({ actionDescription: "", originalStrategy: strategies[0].name, healedStrategy: strategy.name, confidence: 0.8 });
            this.options.logger.warn("Selector healed", { original: strategies[0].name, healed: strategy.name });
          }
          return el;
        } catch { continue; }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Element not found with any selector strategy: ${JSON.stringify({ selectors, selectorCandidates })}`);
  }

  private buildSelectorStrategies(
    scope: any,
    selectors: Record<string, any>,
    selectorCandidates: Array<Record<string, any>>,
    esc: (value: string) => string,
  ): Array<{ name: string; locator: () => import("playwright").Locator }> {
    const strategies: Array<{ name: string; locator: () => import("playwright").Locator }> = [];
    const pushSelector = (source: Record<string, any>, labelPrefix: string) => {
      if (!source) return;
      const pick = (base: import("playwright").Locator): import("playwright").Locator =>
        typeof source.nth === "number" ? base.nth(source.nth) : base.first();
      if (source.role) {
        const { role, name, exact, checked, expanded, selected, pressed } = source.role;
        const opts: any = {};
        if (name) {
          opts.name = exact ? name : new RegExp(esc(name), "i");
          if (exact) opts.exact = true;
        }
        if (typeof checked === "boolean") opts.checked = checked;
        if (typeof expanded === "boolean") opts.expanded = expanded;
        if (typeof selected === "boolean") opts.selected = selected;
        if (typeof pressed === "boolean") opts.pressed = pressed;
        strategies.push({
          name: `${labelPrefix}:role:${role}[${name ?? ""}]`,
          locator: () => pick(scope.getByRole(role, opts))
        });
      }
      if (source.label) {
        strategies.push({
          name: `${labelPrefix}:label:${source.label}`,
          locator: () => pick(scope.getByLabel(new RegExp(esc(source.label), "i")))
        });
      }
      if (source.text) {
        strategies.push({
          name: `${labelPrefix}:text:${source.text}`,
          locator: () => pick(scope.getByText(new RegExp(esc(source.text), "i")))
        });
      }
      if (source.testId) {
        strategies.push({ name: `${labelPrefix}:testId:${source.testId}`, locator: () => pick(scope.getByTestId(source.testId)) });
      }
      if (source.css) {
        strategies.push({ name: `${labelPrefix}:css:${source.css}`, locator: () => pick(scope.locator(source.css)) });
      }
      if (source.xpath) {
        strategies.push({ name: `${labelPrefix}:xpath`, locator: () => pick(scope.locator(`xpath=${source.xpath}`)) });
      }
    };

    for (const candidate of selectorCandidates ?? []) {
      pushSelector(candidate.selector, candidate.id ?? candidate.kind ?? "candidate");
    }
    pushSelector(selectors, "legacy");

    return strategies;
  }

  /** Feature 5: read an element's current ARIA toggle state. */
  private async isAriaStateSatisfied(el: import("playwright").Locator, ariaState: Record<string, any>): Promise<boolean> {
    const matches = async (attr: string, want: boolean | undefined): Promise<boolean> => {
      if (want === undefined) return true;
      const value = await el.getAttribute(attr).catch(() => null);
      return value === String(want);
    };
    return (await matches("aria-checked", ariaState.checked))
      && (await matches("aria-expanded", ariaState.expanded))
      && (await matches("aria-selected", ariaState.selected));
  }

  private async clickElement(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, timeout: number, frameSelector?: string, ariaState?: Record<string, any>): Promise<void> {
    await dismissBlockingZoomPopups(page, this.options.logger);
    if (selectors?.role?.role === "button" && selectors.role.name === "Search" && page.url().includes("#/get-number")) {
      await this.clickGetNumberFormSearchButton(page, timeout);
      return;
    }

    const deadline = Date.now() + timeout;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3 && Date.now() < deadline; attempt++) {
      const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, Math.max(1_000, deadline - Date.now()));
      // Feature 5: skip the click if the element is already in the desired ARIA state (idempotent re-runs).
      if (ariaState && await this.isAriaStateSatisfied(el, ariaState)) {
        this.options.logger.info("Skipping click; element already in desired state", { ariaState });
        return;
      }

      try {
        await el.click({ timeout: Math.min(5_000, Math.max(1_000, deadline - Date.now())) });
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/detached from the DOM|not stable|intercepts pointer events|Timeout/i.test(message)) {
          throw error;
        }
        this.options.logger.warn("Click target changed during action; retrying", { attempt, error: message.slice(0, 240) });
        await page.waitForTimeout(300);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async clickGetNumberFormSearchButton(page: Page, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      const buttons = page.getByRole("button", { name: /^Search$/ });
      const count = await buttons.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const box = await button.boundingBox().catch(() => null);
        if (!box || box.width === 0 || box.height === 0) continue;
        if (box.y < 180) continue;

        try {
          await button.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined);
          await button.click({ timeout: 3_000 });
          return;
        } catch (error) {
          lastError = error;
        }
      }

      await page.mouse.wheel(0, 350).catch(() => undefined);
      await page.waitForTimeout(250);
    }

    throw lastError instanceof Error ? lastError : new Error("Could not find Get Number form Search button");
  }

  private async closePartialPurchaseFailureDialog(page: Page): Promise<boolean> {
    const dialog = page.getByText(/Some Numbers Purchase Failed/i).first();
    if (!await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) return false;

    this.options.logger.warn("Zoom reported a partial number purchase failure");
    await page.getByRole("button", { name: /^Close$/ }).click({ timeout: 5_000 }).catch(async () => {
      await page.keyboard.press("Escape").catch(() => undefined);
    });
    await page.waitForTimeout(750);
    return true;
  }

  private async verifyTargetSydneyNumberCount(page: Page): Promise<boolean> {
    await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/number-list?pageNumber=1&pageSize=15`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    return this.hasAtLeastExistingSydneyPhoneNumbers(page, 4);
  }

  private async hasAtLeastExistingSydneyPhoneNumbers(page: Page, minimumCount: number): Promise<boolean> {
    const visibleCount = await this.countExistingSydneyPhoneNumbers(page);
    return visibleCount >= minimumCount;
  }

  private async countExistingSydneyPhoneNumbers(page: Page): Promise<number> {
    const searchResult = await this.filterPhoneNumberListForAustralianNumbers(page);
    if (!searchResult.applied) {
      this.options.logger.warn("Could not confidently filter phone-number list; treating existing count as zero", {
        targetPrefix: "+612"
      });
      return 0;
    }

    const matchedNumbers = await this.extractVisibleSydneyPhoneNumbers(page);
    const uniqueMatchedNumbers = [...new Set([...searchResult.matchedNumbers, ...matchedNumbers])];
    this.options.logger.info("Existing Sydney phone-number count", {
      visibleSydneyCount: uniqueMatchedNumbers.length,
      targetPrefix: "+612",
      filteredVisibleRows: searchResult.visibleRowCount,
      sampleNumbers: uniqueMatchedNumbers.slice(0, 6)
    });
    return uniqueMatchedNumbers.length;
  }

  private async extractVisibleSydneyPhoneNumbers(page: Page): Promise<string[]> {
    const sydneyNumberPattern = /\+61[\s().-]*2[\d\s().-]{6,}/;
    const rowSelector = [
      "tr",
      "[role='row']",
      ".zcc-compat-zoom-virtual-table__row",
      ".zcc-compat-zoom-table__row",
      ".zcc-compat-zoom-table-row",
      ".zcc-compat-zoom-table__body-row"
    ].join(", ");
    const rows = page.locator(rowSelector).filter({ hasText: sydneyNumberPattern });
    const count = await rows.count().catch(() => 0);
    const numbers = new Set<string>();
    for (let index = 0; index < count; index++) {
      const row = rows.nth(index);
      if (!await row.isVisible({ timeout: 100 }).catch(() => false)) continue;
      const text = await row.innerText({ timeout: 500 }).catch(() => "");
      const matches = text.match(new RegExp(sydneyNumberPattern.source, "g")) ?? [];
      for (const match of matches) {
        numbers.add(this.normalizePhoneNumber(match));
      }
    }
    return [...numbers];
  }

  private normalizePhoneNumber(value: string): string {
    return value.replace(/[^\d+]/g, "");
  }

  private async filterPhoneNumberListForAustralianNumbers(page: Page): Promise<PhoneNumberListSearchResult> {
    const searchInput = await this.findPhoneNumberListSearchInput(page);
    if (!searchInput) {
      return { applied: false, matchedNumbers: [], visibleRowCount: 0 };
    }

    await searchInput.click({ timeout: 3_000 }).catch(() => undefined);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
    await searchInput.fill("+61", { timeout: 3_000 });

    const clickedSearch = await searchInput.evaluate((element) => {
      const isVisible = (candidate: Element): boolean => {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const hasSearchText = (candidate: Element): boolean => {
        const text = `${candidate.textContent ?? ""} ${candidate.getAttribute("aria-label") ?? ""}`.trim();
        return /^Search$/i.test(text) || /\bSearch\b/i.test(text);
      };

      let ancestor: Element | null = element.parentElement;
      for (let depth = 0; ancestor && depth < 7; depth += 1) {
        const button = Array.from(ancestor.querySelectorAll("button, [role='button']"))
          .find((candidate) => isVisible(candidate) && hasSearchText(candidate));
        if (button instanceof HTMLElement) {
          button.click();
          return true;
        }
        ancestor = ancestor.parentElement;
      }

      return false;
    }).catch(() => false);

    if (!clickedSearch) {
      await searchInput.press("Enter", { timeout: 3_000 }).catch(() => undefined);
    }

    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);

    const value = await searchInput.inputValue({ timeout: 1_000 }).catch(() => "");
    const matchedNumbers = await this.extractVisibleSydneyPhoneNumbers(page);
    const visibleRowCount = await this.countVisiblePhoneNumberRows(page);
    const applied = value.includes("+61") || matchedNumbers.length > 0;

    return {
      applied,
      matchedNumbers,
      visibleRowCount
    };
  }

  private async countVisiblePhoneNumberRows(page: Page): Promise<number> {
    const rowSelector = [
      "tr",
      "[role='row']",
      ".zcc-compat-zoom-virtual-table__row",
      ".zcc-compat-zoom-table__row",
      ".zcc-compat-zoom-table-row",
      ".zcc-compat-zoom-table__body-row"
    ].join(", ");
    const rows = page.locator(rowSelector).filter({ hasText: /\+61/ });
    const count = await rows.count().catch(() => 0);
    let visibleCount = 0;
    for (let index = 0; index < count; index++) {
      if (await rows.nth(index).isVisible({ timeout: 100 }).catch(() => false)) visibleCount += 1;
    }
    return visibleCount;
  }

  private async findPhoneNumberListSearchInput(page: Page): Promise<Locator | null> {
    const inputs = page.locator("input:visible");
    const count = await inputs.count().catch(() => 0);
    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const candidate = await input.evaluate((element) => {
        const inputElement = element as HTMLInputElement;
        const descriptor = [
          inputElement.placeholder,
          inputElement.getAttribute("aria-label"),
          inputElement.getAttribute("name"),
          inputElement.id,
          inputElement.className
        ].join(" ");
        const inGlobalChrome = Boolean(inputElement.closest("header, nav, [role='banner'], [class*='header'], [class*='navbar'], [class*='topbar']"));

        let ancestor: Element | null = inputElement.parentElement;
        let hasNearbySearchButton = false;
        for (let depth = 0; ancestor && depth < 7; depth += 1) {
          hasNearbySearchButton = Array.from(ancestor.querySelectorAll("button, [role='button']"))
            .some((button) => /\bSearch\b/i.test(`${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`));
          if (hasNearbySearchButton) break;
          ancestor = ancestor.parentElement;
        }

        return {
          descriptor,
          disabled: inputElement.disabled,
          readOnly: inputElement.readOnly,
          inGlobalChrome,
          hasNearbySearchButton
        };
      }).catch(() => null);

      if (!candidate || candidate.disabled || candidate.readOnly || candidate.inGlobalChrome) continue;

      let score = 0;
      if (/search/i.test(candidate.descriptor)) score += 3;
      if (candidate.hasNearbySearchButton) score += 5;
      if (/number|phone/i.test(candidate.descriptor)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestScore >= 5 && bestIndex >= 0 ? inputs.nth(bestIndex) : null;
  }

  private async openGetNumberWizard(page: Page, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (page.url().includes("#/get-number") && await this.isZoomFormControlVisible(page, "Product", 500)) return;

      try {
        const addButton = page.locator("#wizard-number-btn, button:has-text('Add Number')").first();
        if (await addButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await addButton.click({ timeout: 3_000 }).catch(async () => {
            await addButton.click({ timeout: 3_000, force: true });
          });
        }

        const getNumber = page.locator("#wizard-get-number-2").first();
        await getNumber.waitFor({ state: "visible", timeout: 3_000 });
        await getNumber.click({ timeout: 3_000 }).catch(async () => {
          await getNumber.click({ timeout: 3_000, force: true });
        });
        await this.waitForZoomFormControl(page, "Product", 5_000);
        return;
      } catch (error) {
        lastError = error;
        await page.waitForTimeout(300);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to open Get Number wizard");
  }

  private async isZoomFormControlVisible(page: Page, label: string, timeout: number): Promise<boolean> {
    return Boolean(await this.findZoomFormControl(page, label, timeout).catch(() => null));
  }

  private async waitForZoomFormControl(page: Page, label: string, timeout: number): Promise<void> {
    await this.findZoomFormControl(page, label, timeout);
  }

  private async fillField(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, value: string, timeout: number, frameSelector?: string): Promise<void> {
    const zoomFormLabel = typeof selectors?.role?.name === "string" ? selectors.role.name : typeof selectors?.label === "string" ? selectors.label : undefined;
    if (zoomFormLabel === "Area Code - City") {
      await this.fillZoomFormField(page, zoomFormLabel, value, timeout);
      return;
    }

    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.fill(value, { timeout });
  }

  private async selectOption(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, value: string, timeout: number, frameSelector?: string, selectMetadata: Record<string, any> = {}): Promise<void> {
    const zoomFormLabel = typeof selectors?.role?.name === "string" ? selectors.role.name : undefined;
    if (zoomFormLabel && [
      "Country/Region",
      "State/Province/Territory",
      "Area Code - City",
      "Business Address & Documents"
    ].includes(zoomFormLabel)) {
      await this.selectZoomFormOption(page, zoomFormLabel, selectMetadata.optionLabel ?? value, timeout);
      return;
    }

    const root = this.scope(page, frameSelector);
    const el = await this.findElement(root, selectors, selectorCandidates, timeout);
    const tagName = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      await el.selectOption({ label: value }).catch(async () => {
        await el.selectOption(value);
      });
      return;
    }

    const optionText = selectMetadata.optionLabel ?? value;
    const trigger = await this.findSelectTrigger(el);
    await trigger.click({ timeout });
    await this.filterOpenSelectIfEditable(trigger, value || optionText).catch(() => undefined);
    const popup = await this.findOpenSelectPopup(page, trigger, root, timeout, selectMetadata.popupSelectorHint);
    const optionCandidates = selectMetadata.optionCandidates ?? [];
    const optionSelectors = optionCandidates[0]?.selector ?? { role: { role: "option", name: optionText } };
    const option = optionCandidates.length > 0
      ? await this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000))
          .catch(() => this.findElement(popup, optionSelectors, optionCandidates, Math.min(timeout, 5_000)))
      : await this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000));
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    const verificationText = selectMetadata.verificationText ?? optionText;
    await this.waitForSelectApplied(trigger, verificationText, Math.min(timeout, 5_000));
  }

  private async selectZoomFormOption(page: Page, label: string, value: string, timeout: number): Promise<void> {
    const trigger = await this.findZoomFormControl(page, label, timeout);
    const optionSelector = [
      "[role='option']",
      "[class*='option']",
      "[data-testid*='Option']",
      "[data-testid*='option']",
      "li[aria-label]",
      "li[class*='option']"
    ].join(", ");

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        let option = await this.findMatchingOption(page.locator(optionSelector), value, 750);
        if (!option) {
          await this.clickZoomSelectTrigger(trigger, timeout);
          option = await this.findMatchingOption(page.locator(optionSelector), value, Math.min(timeout, 2_000));
        }
        if (option) {
          await option.click({ timeout: Math.min(timeout, 3_000) });
        } else {
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Enter");
        }

        if (label !== "Product") {
          await page.waitForTimeout(750);
          return;
        }

        await this.waitForZoomFormSelection(page, label, value, Math.min(timeout, 3_000), trigger);
        return;
      } catch (error) {
        lastError = error;
        this.options.logger.warn("Zoom form select did not apply; retrying", {
          label,
          value,
          attempt,
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
        });
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(300);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`No visible ${label} option matching "${value}"`);
  }

  private async fillZoomFormField(page: Page, label: string, value: string, timeout: number): Promise<void> {
    const trigger = await this.findZoomFormControl(page, label, timeout);
    await this.clickZoomSelectTrigger(trigger, timeout);

    const tagName = await trigger.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "input" || tagName === "textarea") {
      await trigger.fill(value, { timeout }).catch(async () => {
        await trigger.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: 1_000 }).catch(() => undefined);
        await trigger.type(value, { timeout: 2_000 });
      });
    } else {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
      await page.keyboard.type(value, { delay: 20 });
    }

    await page.waitForTimeout(500);
  }

  private async clickZoomSelectTrigger(trigger: Locator, timeout: number): Promise<void> {
    const box = await trigger.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await trigger.click({
        timeout,
        position: {
          x: Math.max(1, box.width - 18),
          y: Math.max(1, box.height / 2)
        }
      });
      return;
    }

    await trigger.click({ timeout });
  }

  private async findZoomFormRow(page: Page, label: string, timeout: number): Promise<Locator> {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rowSelector = ".cpzui-form-item__row, .zoom-form-item, .zm-form-item, [class*='form-item']";
    const row = await this.firstVisibleLocator(page.locator(rowSelector).filter({ hasText: new RegExp(escaped, "i") }), 20);
    if (row && await row.isVisible({ timeout: 1_000 }).catch(() => false)) {
      return row;
    }

    const labelEl = await this.findVisibleText(page, new RegExp(`^\\s*${escaped}\\s*$`, "i"), timeout);
    if (labelEl) {
      await labelEl.waitFor({ state: "visible", timeout: 250 });
    }
    throw new Error(`No visible form row found for label "${label}"`);
  }

  private async findZoomFormControl(page: Page, label: string, timeout: number): Promise<Locator> {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = await this.findZoomFormRow(page, label, Math.min(timeout, 1_000)).catch(() => null);
    if (row) return this.findSelectTrigger(row);

    const labelEl = await this.findVisibleText(page, new RegExp(`^\\s*${escaped}\\s*$`, "i"), timeout);
    if (!labelEl) throw new Error(`No visible label found for "${label}"`);
    const followingControl = await this.firstVisibleLocator(
      labelEl.locator("xpath=following::*[@role='combobox' or self::input or self::textarea or contains(@class, 'cpzui-select') or contains(@class, 'cpzui-virtual-filter-select') or contains(@class, 'select')][position() <= 8]"),
      8
    );
    if (followingControl) return this.findSelectTrigger(followingControl);

    throw new Error(`No visible form control found after label "${label}"`);
  }

  private async findVisibleText(page: Page, text: RegExp, timeout: number): Promise<Locator | undefined> {
    const deadline = Date.now() + timeout;
    const locator = page.getByText(text);

    while (Date.now() < deadline) {
      const match = await this.firstVisibleLocator(locator, 30);
      if (match) return match;
      await page.waitForTimeout(150);
    }

    return undefined;
  }

  private async waitForZoomFormSelection(page: Page, label: string, expected: string, timeout: number, knownTrigger?: Locator): Promise<void> {
    const deadline = Date.now() + timeout;
    const observed = new Set<string>();

    while (Date.now() < deadline) {
      if (await this.visibleFormValueNearLabelMatches(page, label, expected, 500)) return;

      const row = await this.findZoomFormRow(page, label, 500).catch(() => null);
      if (row) {
        const texts = await row.evaluate((node) => {
          const visibleText = (root: Element): string => {
            const clone = root.cloneNode(true) as Element;
            clone.querySelectorAll("[aria-hidden='true']").forEach((element) => element.remove());
            return clone.textContent ?? "";
          };
          const values = Array.from(node.querySelectorAll("input, textarea, select"))
            .map((control) => control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement ? control.value : "")
            .filter(Boolean);
          return [visibleText(node), ...values];
        }).catch(() => []);
        for (const text of texts) {
          const normalized = this.normalizeOptionText(text);
          if (normalized) observed.add(normalized);
          if (this.selectedOptionValueMatches(expected, text)) return;
        }
      }

      const triggerCandidates = [
        knownTrigger,
        await this.findZoomFormControl(page, label, 500).catch(() => null)
      ].filter((candidate): candidate is Locator => Boolean(candidate));

      for (const trigger of triggerCandidates) {
        const texts = await trigger.evaluate((node) => {
          const clone = node.cloneNode(true) as Element;
          clone.querySelectorAll("[aria-hidden='true']").forEach((element) => element.remove());
          return [
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node.value : "",
            node.getAttribute("aria-label") ?? "",
            node.getAttribute("placeholder") ?? "",
            clone.textContent ?? ""
          ];
        }).catch(() => []);
        for (const text of texts) {
          const normalized = this.normalizeOptionText(text);
          if (normalized) observed.add(normalized);
          if (this.selectedOptionValueMatches(expected, text)) return;
        }
      }

      await page.waitForTimeout(150);
    }

    throw new Error(`Zoom form select "${label}" did not apply "${expected}". Observed: ${Array.from(observed).slice(0, 6).join(" | ") || "none"}`);
  }

  private async visibleFormValueNearLabelMatches(page: Page, label: string, expected: string, timeout: number): Promise<boolean> {
    const labelEl = await this.findVisibleText(page, new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), timeout);
    if (!labelEl) return false;

    return labelEl.evaluate((labelNode, expectedValue) => {
      const normalize = (value: string): string => value
        .toLowerCase()
        .replace(/([a-z])(\d)/g, "$1 $2")
        .replace(/(\d)([a-z])/g, "$1 $2")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const expectedTokens = normalize(expectedValue).split(" ").filter((token) => token.length > 1);
      if (expectedTokens.length === 0) return false;
      const labelRect = labelNode.getBoundingClientRect();
      const isVisible = (element: Element): boolean => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const visibleText = (element: Element): string => {
        const clone = element.cloneNode(true) as Element;
        clone.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
        return clone.textContent ?? "";
      };

      return Array.from(document.body.querySelectorAll("*")).some((element) => {
        if (element === labelNode || !isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        const horizontallyAligned = rect.left >= labelRect.right && Math.abs((rect.top + rect.height / 2) - (labelRect.top + labelRect.height / 2)) <= 32;
        if (!horizontallyAligned) return false;
        const text = normalize(visibleText(element));
        return expectedTokens.every((token) => text.includes(token));
      });
    }, expected).catch(() => false);
  }

  private async filterOpenSelectIfEditable(trigger: import("playwright").Locator, optionText: string): Promise<void> {
    const tagName = await trigger.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    const isEditable = tagName === "input" || tagName === "textarea" || await trigger.evaluate((node) => (node as HTMLElement).isContentEditable).catch(() => false);
    if (!isEditable) return;

    await trigger.fill(optionText, { timeout: 1_000 }).catch(async () => {
      await trigger.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: 1_000 }).catch(() => undefined);
      await trigger.type(optionText, { timeout: 1_000 }).catch(() => undefined);
    });
    await trigger.page().waitForTimeout(250);
  }

  private async findVisibleSelectOptionByText(
    page: Page,
    popup: import("playwright").Locator,
    optionText: string,
    timeout: number
  ): Promise<import("playwright").Locator> {
    const optionSelector = [
      "[role='option']",
      "li",
      "[class*='option']",
      "[data-testid*='Option']",
      "[data-testid*='option']"
    ].join(", ");

    const scopedOption = await this.findMatchingOption(popup.locator(optionSelector), optionText, Math.min(timeout, 3_000));
    if (scopedOption) return scopedOption;

    const option = await this.findMatchingOption(page.getByRole("option"), optionText, Math.min(timeout, 1_500));
    if (option) return option;

    throw new Error('No visible select option matching "' + optionText + '"');
  }

  private async findMatchingOption(options: import("playwright").Locator, optionText: string, timeout: number): Promise<import("playwright").Locator | undefined> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const count = await options.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const option = options.nth(index);
        if (!await option.isVisible({ timeout: 100 }).catch(() => false)) continue;
        const text = await option.innerText({ timeout: 250 }).catch(() => "");
        if (this.optionTextMatches(optionText, text) || this.selectedOptionValueMatches(optionText, text)) {
          return option;
        }
      }
      await options.first().page().waitForTimeout(150);
    }
    return undefined;
  }

  private async waitForSelectApplied(trigger: import("playwright").Locator, expected: string, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    const observed = new Set<string>();
    while (Date.now() < deadline) {
      const texts = await trigger.evaluate((node) => [
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node.value : "",
        node.getAttribute("aria-label") ?? "",
        node.getAttribute("placeholder") ?? "",
        node.textContent ?? ""
      ]).catch(() => []);
      for (const text of texts) {
        const normalized = this.normalizeOptionText(text);
        if (normalized) observed.add(normalized);
        if (this.selectedOptionValueMatches(expected, text)) return;
      }
      await trigger.page().waitForTimeout(150);
    }
    throw new Error(`Select step did not apply "${expected}". Observed: ${Array.from(observed).slice(0, 6).join(" | ") || "none"}`);
  }

  private selectedOptionValueMatches(expected: string, actual: string): boolean {
    if (this.optionTextMatches(expected, actual)) return true;
    const normalizedActual = this.normalizeOptionText(actual);
    return this.primaryOptionTexts(expected).some((primary) => normalizedActual === this.normalizeOptionText(primary));
  }

  private optionTextMatches(expected: string, actual: string): boolean {
    const expectedTokens = this.meaningfulOptionTokens(expected);
    if (expectedTokens.length === 0) return false;

    const normalizedExpected = this.normalizeOptionText(expected);
    const normalizedActual = this.normalizeOptionText(actual);
    if (normalizedExpected === normalizedActual) return true;

    const actualTokens = new Set(this.meaningfulOptionTokens(actual));
    if (expectedTokens.length === 1) {
      return actualTokens.size === 1 && actualTokens.has(expectedTokens[0]);
    }

    return expectedTokens.every((token) => actualTokens.has(token));
  }

  private primaryOptionTexts(value: string): string[] {
    return [
      value.split(/\s+-\s+/)[0],
      value.split(",")[0]
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part, index, all) => all.indexOf(part) === index);
  }

  private meaningfulOptionTokens(value: string): string[] {
    return this.normalizeOptionText(value)
      .split(" ")
      .filter((token) => token.length > 1);
  }

  private normalizeOptionText(value: string): string {
    return value
      .toLowerCase()
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-z])/g, "$1 $2")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async findSelectTrigger(el: import("playwright").Locator): Promise<import("playwright").Locator> {
    const descendant = await this.firstVisibleLocator(
      el.locator("[role='combobox'], input:not([type='hidden']), textarea, [class*='cpzui-select'], [class*='cpzui-virtual-filter-select'], [class*='select']")
    );
    if (descendant) return descendant;

    const ancestors = [
      el.locator("xpath=ancestor-or-self::*[@role='combobox'][1]"),
      el.locator("xpath=ancestor-or-self::*[contains(@class, 'cpzui-select') or contains(@class, 'cpzui-virtual-filter-select')][1]"),
      el
    ];

    for (const ancestor of ancestors) {
      if (await ancestor.isVisible({ timeout: 250 }).catch(() => false)) return ancestor;
    }

    return el;
  }

  private async firstVisibleLocator(locator: import("playwright").Locator, limit = 30): Promise<import("playwright").Locator | undefined> {
    const count = Math.min(await locator.count().catch(() => 0), limit);
    for (let index = 0; index < count; index++) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible({ timeout: 100 }).catch(() => false)) return candidate;
    }
    return undefined;
  }

  private async findOpenSelectPopup(page: Page, trigger: import("playwright").Locator, root: import("playwright").Page | import("playwright").FrameLocator, timeout: number, popupSelectorHint?: Record<string, any>): Promise<import("playwright").Locator> {
    const deadline = Date.now() + Math.min(timeout, 5_000);
    const controlledId = await trigger.getAttribute("aria-controls").catch(() => null);
    if (controlledId) {
      const controlled = page.locator(`#${controlledId.replace(/"/g, "\\\"")}`).first();
      if (await controlled.isVisible({ timeout: 750 }).catch(() => false)) return controlled;
    }
    if (popupSelectorHint) {
      const hinted = await this.findElement(root, popupSelectorHint, [], 1_000).catch(() => undefined);
      if (hinted) return hinted;
    }
    const popupSelector = [
      "[role='listbox']",
      "[role='menu']",
      "[class*='select-dropdown']",
      "[class*='select__dropdown']",
      "[class*='dropdown-menu']",
      "[class*='cpzui-select'] [role='listbox']",
      "[class*='cpzui-virtual-filter-select']"
    ].join(", ");
    const popups = page.locator(popupSelector).filter({ has: page.locator("[role='option'], li, [class*='option']") });
    while (Date.now() < deadline) {
      const count = await popups.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const popup = popups.nth(index);
        if (await popup.isVisible({ timeout: 100 }).catch(() => false)) {
          return popup;
        }
      }
      await trigger.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
    }

    throw new Error("No visible select popup opened");
  }

  private async uploadFile(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, timeout: number, frameSelector?: string): Promise<void> {
    const docPath = this.options.config.documents.businessVerificationPath ?? this.options.config.documents.idPath;
    if (!docPath) return;
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.setInputFiles(docPath);
  }

  /** Feature 4: hover to reveal menus/tooltips. */
  private async hoverElement(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.hover({ timeout });
  }

  /** Feature 4: press a key, scoped to an element when one was recorded. */
  private async pressKey(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, key: string, timeout: number, frameSelector?: string): Promise<void> {
    if (!selectors || Object.keys(selectors).length === 0) {
      await page.keyboard.press(key);
      return;
    }
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.press(key, { timeout });
  }

  /** Feature 7: click a control and capture the resulting browser download as an artifact. */
  private async downloadFile(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, timeout: number, frameSelector: string | undefined, artifactBase: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    const downloadPromise = page.waitForEvent("download", { timeout });
    await el.click();
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    await download.saveAs(`${artifactBase}-${suggested}`);
    this.options.logger.info("Captured download", { file: suggested });
  }

  /** Feature 9: capture a screenshot scoped to the matched element. */
  private async elementScreenshot(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, path: string, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.screenshot({ path });
  }

  /** Feature 6: auto-retrying field-value assertion (polls until the timeout). */
  private async expectFieldValue(page: Page, expected: string, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const fields = page.locator("input, textarea");
      const count = await fields.count();
      for (let index = 0; index < count; index++) {
        const value = await fields.nth(index).inputValue({ timeout: 1_000 }).catch(() => "");
        if (value.includes(expected)) return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error("Expected a field value to contain " + expected);
  }

  /** Compound condition evaluation (IF/AND/OR/NOT) used by step guards and IF blocks. */
  private async evalPredicate(page: Page, predicate: any): Promise<boolean> {
    if (!predicate || predicate.kind === "always") return true;
    const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    switch (predicate.kind) {
      case "and": {
        const results = await Promise.all((predicate.operands ?? []).map((p: any) => this.evalPredicate(page, p)));
        return results.every(Boolean);
      }
      case "or": {
        const results = await Promise.all((predicate.operands ?? []).map((p: any) => this.evalPredicate(page, p)));
        return results.some(Boolean);
      }
      case "not":
        return !(await this.evalPredicate(page, predicate.operand));
      case "urlContains":
        return page.url().includes(predicate.text ?? "");
      case "textVisible":
        return page.getByText(new RegExp(esc(predicate.text ?? ""), "i")).first().isVisible().catch(() => false);
      case "elementVisible":
        try {
          const el = await this.findElement(page, predicate.selector, [], 3000);
          return await el.isVisible();
        } catch { return false; }
      case "fieldEmpty":
        try {
          const el = await this.findElement(page, predicate.selector, [], 3000);
          return (await el.inputValue().catch(() => "")).trim() === "";
        } catch { return false; }
      case "fieldValue":
        try {
          const el = await this.findElement(page, predicate.selector, [], 3000);
          const value = await el.inputValue().catch(() => "");
          if (predicate.equals !== undefined) return value === predicate.equals;
          if (predicate.contains !== undefined) return value.includes(predicate.contains);
          return value.trim() !== "";
        } catch { return false; }
      default:
        return true;
    }
  }


  private async executeRecordedStep(
    page: Page,
    artifactBase: string,
    description: string,
    policy: { retryCount?: number; retryDelayMs?: number; continueOnFailure?: boolean; screenshotOnFailure?: boolean; readyTimeoutMs?: number },
    step: () => Promise<void>
  ): Promise<void> {
    const attempts = Math.max(1, (policy.retryCount ?? 0) + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await step();
        await this.waitForPageReady(page, policy.readyTimeoutMs ?? 10_000);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          this.options.logger.warn("Recorded step failed; retrying", { description, attempt, attempts, error: error instanceof Error ? error.message : String(error) });
          await page.waitForTimeout(policy.retryDelayMs ?? 1_000);
        }
      }
    }
    if (policy.screenshotOnFailure) {
      await page.screenshot({ path: `${artifactBase}-${description.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-failure.png`, fullPage: true }).catch(() => undefined);
    }
    if (policy.continueOnFailure) {
      this.options.logger.warn("Continuing after recorded step failure", { description, error: lastError instanceof Error ? lastError.message : String(lastError) });
      return;
    }
    throw lastError;
  }

  private async waitForPageReady(page: Page, timeout: number): Promise<void> {
    const shortTimeout = Math.min(Math.max(timeout, 1_000), 5_000);
    const loadingSelectors = [
      "[aria-busy='true']",
      "[role='progressbar']",
      ".loading",
      ".loader",
      ".spinner",
      ".zm-loader",
      ".zm-loading",
      ".cpzui-loading",
      ".cpzui-spinner",
      "[class*='loading']",
      "[class*='spinner']"
    ].join(",");

    await page.waitForLoadState("domcontentloaded", { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForFunction((selectors) => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      return !Array.from(document.querySelectorAll(selectors)).some((element) => {
        const text = element.textContent?.toLowerCase() ?? "";
        return visible(element) && !text.includes("loaded") && !text.includes("not loading");
      });
    }, loadingSelectors, { timeout: shortTimeout }).catch(() => undefined);
    await page.waitForTimeout(300);
  }

  private async shouldSkipRecordedStep(page: Page, condition: Record<string, any> | undefined, actionSelectors: Record<string, any>): Promise<"step" | "account" | undefined> {
    if (!condition || condition.type === "none") return undefined;
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const conditionText = condition.text as string | undefined;
    if (condition.type === "textExistsSkip" && conditionText && bodyText.toLowerCase().includes(conditionText.toLowerCase())) {
      return "step";
    }
    if (condition.type === "addressAlreadyExistsSkipAccount" && conditionText) {
      return bodyText.toLowerCase().includes(conditionText.toLowerCase()) && this.targetAlreadyExists(bodyText)
        ? "account"
        : undefined;
    }
    if (condition.type === "addressAlreadyExistsSkipAccount" && this.targetAlreadyExists(bodyText)) {
      return "account";
    }
    if (condition.type === "entityStateGuard") {
      const matched = this.entityStateGuardMatched(bodyText, condition);
      if (matched && condition.whenMatched === "skipAccount") return "account";
      if (matched && condition.whenMatched === "skipStep") return "step";
      if (!matched && condition.whenMissing === "skipAccount") return "account";
      if (!matched && condition.whenMissing === "skipStep") return "step";
      return undefined;
    }
    if (condition.type === "elementVisibleClick") {
      return await this.isElementVisible(page, condition.selector ?? actionSelectors) ? undefined : "step";
    }
    if (condition.type === "fieldEmptyFill") {
      const element = await this.findElement(page, condition.selector ?? actionSelectors, [], 2_000).catch(() => undefined);
      if (!element) return "step";
      const value = await element.inputValue({ timeout: 500 }).catch(() => "");
      return value.trim() ? "step" : undefined;
    }
    return undefined;
  }

  private async isElementVisible(page: Page, selectors: Record<string, any>): Promise<boolean> {
    try {
      const element = await this.findElement(page, selectors, [], 2_000);
      return await element.isVisible();
    } catch {
      return false;
    }
  }

  private targetAlreadyExists(pageText: string): boolean {
    const config = this.options.config.address;
    const tokens = [config.line1, config.city, config.postalCode].filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => pageText.toLowerCase().includes(token!.toLowerCase()));
  }

  private entityStateGuardMatched(pageText: string, condition: Record<string, any>): boolean {
    const lower = pageText.toLowerCase();
    const allText = Array.isArray(condition.match?.allText) ? condition.match.allText : [];
    const anyText = Array.isArray(condition.match?.anyText) ? condition.match.anyText : [];
    const allMatched = allText.length === 0 || allText.every((token: string) => lower.includes(String(token).toLowerCase()));
    const anyMatched = anyText.length === 0 || anyText.some((token: string) => lower.includes(String(token).toLowerCase()));
    return allMatched && anyMatched && (allText.length > 0 || anyText.length > 0);
  }

  private async expectEntityPresence(page: Page, expected: string, shouldExist: boolean, timeout: number): Promise<void> {
    const tokens = expected.split("|").map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) throw new Error("Entity assertion requires at least one fingerprint token");
    const deadline = Date.now() + timeout;
    let matched = false;
    while (Date.now() < deadline) {
      const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      const lower = bodyText.toLowerCase();
      matched = tokens.every((token) => lower.includes(token.toLowerCase()));
      if (matched === shouldExist) return;
      await page.waitForTimeout(250);
    }
    throw new Error("Expected entity fingerprint " + tokens.join(" | ") + (shouldExist ? " to be visible" : " to be absent"));
  }
}

// Default export lets the server load and instantiate this flow via dynamic import.
export default AddZoomPhoneSydneyNumbersFlow;
