import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../../../automation/types.js";
import type { AppConfig } from "../../../config.js";
import type { Logger } from "../../../logger.js";
import type { StorageState } from "../../../zoom/auth.js";
import { impersonateSubAccount } from "../../../zoom/impersonation.js";
import { dismissBlockingZoomPopups } from "../../../zoom/popups.js";
import { resolveSelector } from "../../../runtime/selectors/selectorResolver.js";

export interface AddAuContactCenterBusinessAddressFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  getMasterStorageState?: () => StorageState;
  config: AppConfig;
  logger: Logger;
}

export class AddAuContactCenterBusinessAddressFlow implements AutomationFlow {
  readonly name = "add-au-contact-center-business-address";

  constructor(private readonly options: AddAuContactCenterBusinessAddressFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const activeAccountId = input.account.id;
    let dryRunSkipped = false;
    const context = await this.options.browser.newContext({
      storageState: this.options.getMasterStorageState?.() ?? this.options.masterStorageState
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${input.account.id.replace(/[^a-z0-9_.-]/gi, "_")}-add-au-contact-center-business-address-${Date.now()}`
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
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Navigate to Business Address & Documents - Zoom" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Navigate to Business Address & Documents - Zoom", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await page.goto(`${this.options.config.zoom.webBaseUrl.replace(/\/$/, "")}/cpw/page/phoneNumbers#/business-address?pageSize=15&pageNumber=1`, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        await dismissBlockingZoomPopups(page, this.options.logger);
          });
      // Auto verification (urlContains)
        await page.waitForURL((url) => url.href.includes("#/business-address?pageSize=15&pageNumber=1"), { timeout: 15000 });
        }
      }

      // Step 2: Click "Add Address"
      {
        const skip = await this.shouldSkipRecordedStep(page, {"type":"addressAlreadyExistsSkipAccount","text":"Virtual Service"}, {"role":{"role":"button","name":"Add Address"},"label":"Add Address","text":"Add Address","css":"div.business-list > div:nth-child(3) > button.cpzui-button.cpzui-button--md > span"});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Add Address\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Click \"Add Address\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        const __networkWait = page.waitForResponse((response) => response.url().includes("/cp/webapi/kyc/country"), { timeout: 10000 }).catch(() => undefined);
        await this.clickElement(page, {"role":{"role":"button","name":"Add Address"},"label":"Add Address","text":"Add Address","css":"div.business-list > div:nth-child(3) > button.cpzui-button.cpzui-button--md > span"}, [{"id":"role-button-add-address","kind":"role","selector":{"role":{"role":"button","name":"Add Address"}},"source":"recorded","label":"button Add Address","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<button \"Add Address\">"}},{"id":"xpath-div-div-3-button-span","kind":"xpath","selector":{"xpath":"//div/div[3]/button/span"},"source":"recorded","label":"//div/div[3]/button/span","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<span \"Add Address\">"}},{"id":"label-add-address","kind":"label","selector":{"label":"Add Address"},"source":"recorded","label":"Add Address","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}},{"id":"text-add-address","kind":"text","selector":{"text":"Add Address"},"source":"recorded","label":"Add Address","diagnostics":{"matchedCount":15,"visibleCount":15,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">"}},{"id":"css-div-business-list-div-nth-child-3-button-cpzui-button-cpzui-butt","kind":"css","selector":{"css":"div.business-list > div:nth-child(3) > button.cpzui-button.cpzui-button--md > span"},"source":"recorded","label":"div.business-list > div:nth-child(3) > button.cpzui-button.cpzui-button--md > span","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false}}], 10000, undefined);
        await __networkWait;
          });
        }
      }

      // Step 3: Select "Contact Center" in Product
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Product"},"anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Contact Center\" in Product" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Contact Center\" in Product", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Product"},"anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-combobox-product","kind":"role","selector":{"role":{"role":"combobox","name":"Product"},"anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Product","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Phone\">"}},{"id":"label-product","kind":"label","selector":{"label":"Product","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Product","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Phone\">"}},{"id":"text-phone","kind":"text","selector":{"text":"Phone","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Phone","diagnostics":{"matchedCount":8,"visibleCount":8,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 104 visible matches to 8","directMatchedCount":104,"directVisibleCount":104,"contextMatchedCount":8,"contextVisibleCount":8},"chosenPreview":"<div \"Press Tab for more informationPress arrow left/right to focus on selected values\">"}},{"id":"css-div-nth-child-1-div-div-span","kind":"css","selector":{"css":"div:nth-child(1) > div > div > span","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > span","diagnostics":{"matchedCount":4,"visibleCount":3,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 31 visible matches to 3","directMatchedCount":34,"directVisibleCount":31,"contextMatchedCount":4,"contextVisibleCount":3},"chosenPreview":"<span \"Product\">"}},{"id":"xpath-div-1-div-div-span","kind":"xpath","selector":{"xpath":"//div[1]/div/div/span","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/span","diagnostics":{"matchedCount":36,"visibleCount":33,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":36,"directVisibleCount":33,"contextMatchedCount":36,"contextVisibleCount":33},"chosenPreview":"<span \"By audience\">"}}], "Contact Center", 10000, undefined, {"targetCandidates":[{"id":"role-combobox-product","kind":"role","selector":{"role":{"role":"combobox","name":"Product"},"anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Product","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Phone\">"}},{"id":"label-product","kind":"label","selector":{"label":"Product","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Product","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Phone\">"}},{"id":"text-phone","kind":"text","selector":{"text":"Phone","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Phone","diagnostics":{"matchedCount":8,"visibleCount":8,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 104 visible matches to 8","directMatchedCount":104,"directVisibleCount":104,"contextMatchedCount":8,"contextVisibleCount":8},"chosenPreview":"<div \"Press Tab for more informationPress arrow left/right to focus on selected values\">"}},{"id":"css-div-nth-child-1-div-div-span","kind":"css","selector":{"css":"div:nth-child(1) > div > div > span","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > span","diagnostics":{"matchedCount":4,"visibleCount":3,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 31 visible matches to 3","directMatchedCount":34,"directVisibleCount":31,"contextMatchedCount":4,"contextVisibleCount":3},"chosenPreview":"<span \"Product\">"}},{"id":"xpath-div-1-div-div-span","kind":"xpath","selector":{"xpath":"//div[1]/div/div/span","anchor":{"text":"Product","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/span","diagnostics":{"matchedCount":36,"visibleCount":33,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":36,"directVisibleCount":33,"contextMatchedCount":36,"contextVisibleCount":33},"chosenPreview":"<span \"By audience\">"}}],"optionCandidates":[{"id":"role-option-contact-center","kind":"role","selector":{"role":{"role":"option","name":"Contact Center","exact":true}},"source":"generated","label":"option Contact Center","diagnostics":{"matchedCount":5,"visibleCount":5,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<li \"Contact Center\">"}},{"id":"css-div-ul-li-cpzui-select-option-nth-child-2-div","kind":"css","selector":{"css":"div > ul > li.cpzui-select-option:nth-child(2) > div"},"source":"recorded","label":"div > ul > li.cpzui-select-option:nth-child(2) > div","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<div \"Contact Center\">"}},{"id":"text-contact-center","kind":"text","selector":{"text":"Contact Center"},"source":"recorded","label":"Contact Center","diagnostics":{"matchedCount":64,"visibleCount":64,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">"}},{"id":"xpath-div-ul-li-2-div","kind":"xpath","selector":{"xpath":"//div/ul/li[2]/div"},"source":"recorded","label":"//div/ul/li[2]/div","diagnostics":{"matchedCount":5,"visibleCount":4,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<div \"By industry Education Financial services Government Healthcare Manufacturing Ret\">"}}],"optionLabel":"Contact Center","verificationText":"Contact Center"});
          });
        }
      }

      // Step 4: Select "Australia" in Country/Region
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Australia\" in Country/Region" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Australia\" in Country/Region", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-combobox-country-region","kind":"role","selector":{"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 9 visible matches to 1","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-country-region","kind":"label","selector":{"label":"Country/Region","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Country/Region","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":0,"directVisibleCount":0,"contextMatchedCount":0,"contextVisibleCount":0}}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":10,"visibleCount":10,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":10,"directVisibleCount":10,"contextMatchedCount":10,"contextVisibleCount":10},"chosenPreview":"<input>"}}], this.resolveValue("{{address.country}}", activeAccountId), 10000, undefined, {"targetCandidates":[{"id":"role-combobox-country-region","kind":"role","selector":{"role":{"role":"combobox","name":"Country/Region"},"anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Country/Region","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-nth-child-1-div-div-input","kind":"css","selector":{"css":"div:nth-child(1) > div > div > input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 9 visible matches to 1","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-country-region","kind":"label","selector":{"label":"Country/Region","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Country/Region","diagnostics":{"matchedCount":0,"visibleCount":0,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":0,"directVisibleCount":0,"contextMatchedCount":0,"contextVisibleCount":0}}},{"id":"xpath-div-1-div-div-input","kind":"xpath","selector":{"xpath":"//div[1]/div/div/input","anchor":{"text":"Country/Region","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/input","diagnostics":{"matchedCount":10,"visibleCount":10,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":10,"directVisibleCount":10,"contextMatchedCount":10,"contextVisibleCount":10},"chosenPreview":"<input>"}}],"optionCandidates":[{"id":"testId-virtualfilterselectoptionuniquekey-au","kind":"testId","selector":{"testId":"__VirtualFilterSelectOptionUniqueKey__AU"},"source":"recorded","label":"__VirtualFilterSelectOptionUniqueKey__AU","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<div \"Australia\">"}},{"id":"role-option-australia","kind":"role","selector":{"role":{"role":"option","name":"Australia","exact":true}},"source":"generated","label":"option Australia","diagnostics":{"matchedCount":2,"visibleCount":2,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<div \"Australia\">"}},{"id":"css-div-div-div-cpzui-virtual-filter-select-option-nth-child-2-div","kind":"css","selector":{"css":"div > div > div.cpzui-virtual-filter-select-option:nth-child(2) > div"},"source":"recorded","label":"div > div > div.cpzui-virtual-filter-select-option:nth-child(2) > div","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<div \"Australia\">"}},{"id":"text-australia","kind":"text","selector":{"text":"Australia"},"source":"recorded","label":"Australia","diagnostics":{"matchedCount":10,"visibleCount":10,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">"}},{"id":"xpath-div-div-div-2-div","kind":"xpath","selector":{"xpath":"//div/div/div[2]/div"},"source":"recorded","label":"//div/div/div[2]/div","diagnostics":{"matchedCount":45,"visibleCount":45,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<div \"Communication Meetings Chat Phone Mail & Calendar Scheduler Productivity Canvas \">"}}],"optionLabel":"Australia","verificationText":"Australia"});
          });
        }
      }

      // Step 5: Select "Virtual Service - Incoming Call · Outgoing Call" in Number Type & Capability
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"combobox","name":"Number Type & Capability"},"anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Select \"Virtual Service - Incoming Call · Outgoing Call\" in Number Type & Capability" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Select \"Virtual Service - Incoming Call · Outgoing Call\" in Number Type & Capability", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.selectOption(page, {"role":{"role":"combobox","name":"Number Type & Capability"},"anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-combobox-number-type-capability","kind":"role","selector":{"role":{"role":"combobox","name":"Number Type & Capability"},"anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Number Type & Capability","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Select\">"}},{"id":"label-number-type-capability","kind":"label","selector":{"label":"Number Type & Capability","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Number Type & Capability","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Select\">"}},{"id":"text-select","kind":"text","selector":{"text":"Select","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Select","diagnostics":{"matchedCount":10,"visibleCount":8,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 46 visible matches to 8","directMatchedCount":52,"directVisibleCount":46,"contextMatchedCount":10,"contextVisibleCount":8},"chosenPreview":"<div \"Press Tab for more informationPress arrow left/right to focus on selected values\">"}},{"id":"css-div-nth-child-1-div-div-span","kind":"css","selector":{"css":"div:nth-child(1) > div > div > span","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > span","diagnostics":{"matchedCount":3,"visibleCount":2,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 31 visible matches to 2","directMatchedCount":34,"directVisibleCount":31,"contextMatchedCount":3,"contextVisibleCount":2},"chosenPreview":"<span \"Number Type & Capability\">"}},{"id":"xpath-div-1-div-div-span","kind":"xpath","selector":{"xpath":"//div[1]/div/div/span","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/span","diagnostics":{"matchedCount":36,"visibleCount":33,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":36,"directVisibleCount":33,"contextMatchedCount":36,"contextVisibleCount":33},"chosenPreview":"<span \"By audience\">"}}], "Virtual Service - Incoming Call · Outgoing Call", 10000, undefined, {"targetCandidates":[{"id":"role-combobox-number-type-capability","kind":"role","selector":{"role":{"role":"combobox","name":"Number Type & Capability"},"anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"combobox Number Type & Capability","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Select\">"}},{"id":"label-number-type-capability","kind":"label","selector":{"label":"Number Type & Capability","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Number Type & Capability","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<span \"Select\">"}},{"id":"text-select","kind":"text","selector":{"text":"Select","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Select","diagnostics":{"matchedCount":10,"visibleCount":8,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 46 visible matches to 8","directMatchedCount":52,"directVisibleCount":46,"contextMatchedCount":10,"contextVisibleCount":8},"chosenPreview":"<div \"Press Tab for more informationPress arrow left/right to focus on selected values\">"}},{"id":"css-div-nth-child-1-div-div-span","kind":"css","selector":{"css":"div:nth-child(1) > div > div > span","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div:nth-child(1) > div > div > span","diagnostics":{"matchedCount":3,"visibleCount":2,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 31 visible matches to 2","directMatchedCount":34,"directVisibleCount":31,"contextMatchedCount":3,"contextVisibleCount":2},"chosenPreview":"<span \"Number Type & Capability\">"}},{"id":"xpath-div-1-div-div-span","kind":"xpath","selector":{"xpath":"//div[1]/div/div/span","anchor":{"text":"Number Type & Capability","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div[1]/div/div/span","diagnostics":{"matchedCount":36,"visibleCount":33,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":36,"directVisibleCount":33,"contextMatchedCount":36,"contextVisibleCount":33},"chosenPreview":"<span \"By audience\">"}}],"optionCandidates":[{"id":"role-option-virtual-service-incoming-call-outgoing-call","kind":"role","selector":{"role":{"role":"option","name":"Virtual Service - Incoming Call · Outgoing Call","exact":true}},"source":"generated","label":"option Virtual Service - Incoming Call · Outgoing Call","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<li \"Virtual ServiceIncoming Call · Outgoing Call\">"}},{"id":"role-option-virtual-serviceincoming-call-outgoing-call","kind":"role","selector":{"role":{"role":"option","name":"Virtual ServiceIncoming Call · Outgoing Call","exact":true}},"source":"recorded","label":"option Virtual ServiceIncoming Call · Outgoing Call","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<div \"Virtual ServiceIncoming Call · Outgoing Call\">"}},{"id":"css-div-ul-li-cpzui-select-option-nth-child-3-div","kind":"css","selector":{"css":"div > ul > li.cpzui-select-option:nth-child(3) > div"},"source":"recorded","label":"div > ul > li.cpzui-select-option:nth-child(3) > div","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<div \"Virtual ServiceIncoming Call · Outgoing Call\">"}},{"id":"text-virtual-serviceincoming-call-outgoing-call","kind":"text","selector":{"text":"Virtual ServiceIncoming Call · Outgoing Call"},"source":"recorded","label":"Virtual ServiceIncoming Call · Outgoing Call","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">"}},{"id":"xpath-div-ul-li-3-div","kind":"xpath","selector":{"xpath":"//div/ul/li[3]/div"},"source":"recorded","label":"//div/ul/li[3]/div","diagnostics":{"matchedCount":8,"visibleCount":7,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<div \"Explore Zoom blog Resource library Webinars & events Customer stories Zoom Trust\">"}}],"optionLabel":"Virtual Service - Incoming Call · Outgoing Call","verificationText":"Virtual Service - Incoming Call · Outgoing Call"});
          });
        }
      }

      // Step 6: Fill "Address Line 1" with "9 Castlereagh St"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"Address Line 1"},"label":"Address Line 1","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"Address Line 1\" with \"9 Castlereagh St\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"Address Line 1\" with \"9 Castlereagh St\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"Address Line 1"},"label":"Address Line 1","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-address-line-1","kind":"role","selector":{"role":{"role":"textbox","name":"Address Line 1"},"anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox Address Line 1","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-address-line-1","kind":"label","selector":{"label":"Address Line 1","anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Address Line 1","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"Address Line 1","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{address.line1}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 7: Fill "Address Line 2 (Optional)" with "Level 1"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"Address Line 2 (Optional)"},"label":"Address Line 2 (Optional)","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"Address Line 2 (Optional)\" with \"Level 1\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"Address Line 2 (Optional)\" with \"Level 1\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"Address Line 2 (Optional)"},"label":"Address Line 2 (Optional)","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-address-line-2-optional","kind":"role","selector":{"role":{"role":"textbox","name":"Address Line 2 (Optional)"},"anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox Address Line 2 (Optional)","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-address-line-2-optional","kind":"label","selector":{"label":"Address Line 2 (Optional)","anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Address Line 2 (Optional)","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"Address Line 2 (Optional)","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{address.line2}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 8: Fill "State/Province/Territory" with "NSW"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"State/Province/Territory"},"label":"State/Province/Territory","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"State/Province/Territory\" with \"NSW\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"State/Province/Territory\" with \"NSW\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"State/Province/Territory"},"label":"State/Province/Territory","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-state-province-territory","kind":"role","selector":{"role":{"role":"textbox","name":"State/Province/Territory"},"anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-state-province-territory","kind":"label","selector":{"label":"State/Province/Territory","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"State/Province/Territory","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"State/Province/Territory","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{address.state}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 9: Fill "City" with "Sydney"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"City"},"label":"City","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"City\" with \"Sydney\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"City\" with \"Sydney\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"City"},"label":"City","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-city","kind":"role","selector":{"role":{"role":"textbox","name":"City"},"anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox City","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-city","kind":"label","selector":{"label":"City","anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"City","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"City","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{address.city}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 10: Fill "Zip/Postal Code" with "2000"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"Zip/Postal Code"},"label":"Zip/Postal Code","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"Zip/Postal Code\" with \"2000\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"Zip/Postal Code\" with \"2000\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"Zip/Postal Code"},"label":"Zip/Postal Code","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-zip-postal-code","kind":"role","selector":{"role":{"role":"textbox","name":"Zip/Postal Code"},"anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox Zip/Postal Code","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-zip-postal-code","kind":"label","selector":{"label":"Zip/Postal Code","anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Zip/Postal Code","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"Zip/Postal Code","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{address.postalCode}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 11: Fill "Customer Name" with "Zoom Communications Ltd"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"textbox","name":"Customer Name"},"label":"Customer Name","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Fill \"Customer Name\" with \"Zoom Communications Ltd\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          await this.executeRecordedStep(page, artifactBase, "Fill \"Customer Name\" with \"Zoom Communications Ltd\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        await this.fillField(page, {"role":{"role":"textbox","name":"Customer Name"},"label":"Customer Name","css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}}, [{"id":"role-textbox-customer-name","kind":"role","selector":{"role":{"role":"textbox","name":"Customer Name"},"anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"textbox Customer Name","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"label-customer-name","kind":"label","selector":{"label":"Customer Name","anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"Customer Name","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"fallback","reason":"Direct selector is unique; context kept as fallback","directMatchedCount":1,"directVisibleCount":1,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"css-div-div-nth-child-2-div-cpzui-input-cpzui-input-md-input","kind":"css","selector":{"css":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"div > div:nth-child(2) > div.cpzui-input.cpzui-input--md > input","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":true,"context":{"appliedAutomatically":true,"mode":"primary","reason":"Context narrowed 6 visible matches to 1","directMatchedCount":6,"directVisibleCount":6,"contextMatchedCount":1,"contextVisibleCount":1},"chosenPreview":"<input>"}},{"id":"xpath-div-div-2-div-input","kind":"xpath","selector":{"xpath":"//div/div[2]/div/input","anchor":{"text":"Customer Name","scopeSelector":".cpzui-form-item__row","relationship":"nearControl","kind":"formField"}},"source":"recorded","label":"//div/div[2]/div/input","diagnostics":{"matchedCount":9,"visibleCount":9,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"context":{"appliedAutomatically":true,"mode":"diagnostic","reason":"Context recorded for diagnostics","directMatchedCount":9,"directVisibleCount":9,"contextMatchedCount":9,"contextVisibleCount":9},"chosenPreview":"<input>"}}], this.resolveValue("{{customerName}}", activeAccountId), 10000, undefined);
          });
        }
      }

      // Step 12: Click "Save"
      {
        const skip = await this.shouldSkipRecordedStep(page, undefined, {"role":{"role":"button","name":"Save"},"text":"Save","css":"div:nth-child(2) > div > button.cpzui-button.cpzui-button--md:nth-child(2) > span"});
        if (skip === "account") {
          this.options.logger.info("Recorded workflow skip condition matched", { step: "Click \"Save\"" });
          return { status: "skipped", message: "Skip condition matched" };
        }
        if (skip !== "step") {
          if (this.options.config.runtime.dryRun) {
            dryRunSkipped = true;
            this.options.logger.info("Dry run: skipping mutating step", { step: "Click \"Save\"" });
          } else {
            await this.executeRecordedStep(page, artifactBase, "Click \"Save\"", {"retryCount":0,"retryDelayMs":1000,"continueOnFailure":false,"screenshotOnFailure":false,"readyTimeoutMs":10000}, async () => {
        const __networkWait = page.waitForResponse((response) => response.url().includes("/cp/webapi/findRecommendGeoAddress"), { timeout: 10000 }).catch(() => undefined);
        await this.clickElement(page, {"role":{"role":"button","name":"Save"},"text":"Save","css":"div:nth-child(2) > div > button.cpzui-button.cpzui-button--md:nth-child(2) > span"}, [{"id":"role-button-save","kind":"role","selector":{"role":{"role":"button","name":"Save"}},"source":"recorded","label":"button Save","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<button \"Save\">"}},{"id":"css-div-nth-child-2-div-button-cpzui-button-cpzui-button-md-nth-chil","kind":"css","selector":{"css":"div:nth-child(2) > div > button.cpzui-button.cpzui-button--md:nth-child(2) > span"},"source":"recorded","label":"div:nth-child(2) > div > button.cpzui-button.cpzui-button--md:nth-child(2) > span","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<span \"Save\">"}},{"id":"xpath-div-2-div-button-2-span","kind":"xpath","selector":{"xpath":"//div[2]/div/button[2]/span"},"source":"recorded","label":"//div[2]/div/button[2]/span","diagnostics":{"matchedCount":1,"visibleCount":1,"uniquelyIdentifiesTarget":true,"anchorReducedMatches":false,"chosenPreview":"<span \"Save\">"}},{"id":"text-save","kind":"text","selector":{"text":"Save"},"source":"recorded","label":"Save","diagnostics":{"matchedCount":21,"visibleCount":21,"uniquelyIdentifiesTarget":false,"anchorReducedMatches":false,"chosenPreview":"<html \"!function(e,t){\"object\"==typeof exports&&\"undefined\"!=typeof module?module.expor\">"}}], 10000, undefined);
        await __networkWait;
          });
      // Auto verification (tableRowContains)
      try {
        await page.locator("tr, [role='row']", { hasText: "Virtual Service" }).first().waitFor({ state: "visible", timeout: 15000 });
      } catch (error) {
        await page.screenshot({ path: `${artifactBase}-verify-failure.png`, fullPage: true }).catch(() => undefined);
        throw error;
      }
          }
        }
      }

      await context.tracing.stop();
      return dryRunSkipped
        ? { status: "skipped", message: "Dry run: mutating steps were not submitted" }
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
    const pick = (base: import("playwright").Locator): import("playwright").Locator =>
      typeof selectors.nth === "number" ? base.nth(selectors.nth) : base.first();

    const strategies = this.buildSelectorStrategies(scope, selectors, selectorCandidates, esc, pick);

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
    pick: (base: import("playwright").Locator) => import("playwright").Locator
  ): Array<{ name: string; locator: () => import("playwright").Locator }> {
    const strategies: Array<{ name: string; locator: () => import("playwright").Locator }> = [];
    const pushSelector = (source: Record<string, any>, labelPrefix: string) => {
      if (!source) return;
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
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    // Feature 5: skip the click if the element is already in the desired ARIA state (idempotent re-runs).
    if (ariaState && await this.isAriaStateSatisfied(el, ariaState)) {
      this.options.logger.info("Skipping click; element already in desired state", { ariaState });
      return;
    }
    await el.click();
  }

  private async fillField(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, value: string, timeout: number, frameSelector?: string): Promise<void> {
    const el = await this.findElement(this.scope(page, frameSelector), selectors, selectorCandidates, timeout);
    await el.fill(value, { timeout });
  }

  private async selectOption(page: Page, selectors: Record<string, any>, selectorCandidates: Array<Record<string, any>>, value: string, timeout: number, frameSelector?: string, selectMetadata: Record<string, any> = {}): Promise<void> {
    const root = this.scope(page, frameSelector);
    const el = await this.findElement(root, selectors, selectorCandidates, timeout);
    const tagName = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      await el.selectOption({ label: value }).catch(async () => {
        await el.selectOption(value);
      });
      return;
    }

    await el.click({ timeout });
    const popup = await this.findOpenSelectPopup(page, el, root, timeout, selectMetadata.popupSelectorHint);
    const optionText = selectMetadata.optionLabel ?? value;
    await this.filterOpenSelectIfEditable(el, optionText).catch(() => undefined);
    const optionCandidates = selectMetadata.optionCandidates ?? [];
    const optionSelectors = optionCandidates[0]?.selector ?? { role: { role: "option", name: optionText } };
    const option = optionCandidates.length > 0
      ? await this.findElement(popup, optionSelectors, optionCandidates, Math.min(timeout, 5_000))
          .catch(() => this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000)))
      : await this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000));
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    const verificationText = selectMetadata.verificationText ?? optionText;
    await el.filter({ hasText: new RegExp(verificationText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
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
    const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const exact = new RegExp("^\\s*" + escaped + "\\s*$", "i");
    const loose = new RegExp(escaped, "i");
    const optionSelector = [
      "[role='option']",
      "li",
      "[class*='option']",
      "[data-testid*='Option']",
      "[data-testid*='option']"
    ].join(", ");

    for (const scope of [popup, page.locator("body")]) {
      const exactOption = scope.locator(optionSelector).filter({ hasText: exact }).first();
      if (await exactOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return exactOption;

      const looseOption = scope.locator(optionSelector).filter({ hasText: loose }).first();
      if (await looseOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return looseOption;
    }

    const roleOption = page.getByRole("option", { name: loose }).first();
    if (await roleOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return roleOption;

    throw new Error('No visible select option matching "' + optionText + '"');
  }

  private async findOpenSelectPopup(page: Page, trigger: import("playwright").Locator, root: import("playwright").Page | import("playwright").FrameLocator, timeout: number, popupSelectorHint?: Record<string, any>): Promise<import("playwright").Locator> {
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
    const popup = page.locator(popupSelector).filter({ has: page.locator("[role='option'], li, [class*='option']") }).last();
    await popup.waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) });
    return popup;
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
}

// Default export lets the server load and instantiate this flow via dynamic import.
export default AddAuContactCenterBusinessAddressFlow;
