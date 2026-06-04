import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright";
import type { AutomationFlow, FlowInput, FlowResult } from "../automation/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { StorageState } from "./auth.js";
import { impersonateSubAccount } from "./impersonation.js";
import { dismissBlockingZoomPopups, isDismissibleZoomDialogText } from "./popups.js";

export { dismissBlockingZoomPopups, isDismissibleZoomDialogText };

export interface BusinessAddressFlowOptions {
  browser: Browser;
  masterStorageState: StorageState;
  getMasterStorageState?: () => StorageState;
  config: AppConfig;
  logger: Logger;
}

export class BusinessAddressFlow implements AutomationFlow {
  readonly name = "zoom-business-address";

  constructor(private readonly options: BusinessAddressFlowOptions) {}

  async run(input: FlowInput): Promise<FlowResult> {
    const context = await this.options.browser.newContext({
      storageState: this.options.getMasterStorageState?.() ?? this.options.masterStorageState,
      acceptDownloads: true
    });
    const page = await context.newPage();
    const artifactBase = path.join(
      this.options.config.runtime.artifactsDir,
      `${safeFileName(input.account.id)}-${Date.now()}`
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

      await this.openBusinessAddressPage(page);
      await dismissBlockingZoomPopups(page, this.options.logger);

      if (await this.addressAlreadyVisible(page)) {
        this.options.logger.info("Business address already appears on page; skipping add", {
          accountId: input.account.id
        });
        await context.tracing.stop();
        return { status: "skipped", message: "Address already present" };
      }

      if (this.options.config.runtime.dryRun) {
        await this.openAndFillAddressForm(page);
        await page.screenshot({ path: `${artifactBase}-dry-run.png`, fullPage: true });
        await context.tracing.stop({ path: `${artifactBase}-dry-run-trace.zip` });
        return { status: "skipped", message: "Dry run completed after filling form before submission" };
      }

      await this.addAddress(page);
      await this.verifyAddressAdded(page);
      await context.tracing.stop();
      return { status: "completed" };
    } catch (error) {
      await page.screenshot({ path: `${artifactBase}-failure.png`, fullPage: true }).catch(() => undefined);
      await writeFailureDetails(page, `${artifactBase}-failure.json`, error).catch(() => undefined);
      await context.tracing.stop({ path: `${artifactBase}-trace.zip` }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private async openBusinessAddressPage(page: Page): Promise<void> {
    const url = `${this.options.config.zoom.webBaseUrl.replace(
      /\/$/,
      ""
    )}/cpw/page/phoneNumbers#/business-address`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

    if (page.url().includes("/signin")) {
      throw new Error("Zoom redirected to sign-in while opening the business address page");
    }
  }

  private async addressAlreadyVisible(page: Page): Promise<boolean> {
    const pageText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    return businessAddressAppearsInPageText(pageText, this.options.config.address);
  }

  private async addAddress(page: Page): Promise<void> {
    await this.openAndFillAddressForm(page);
    await attachVisibleDocuments(page, this.options.config.documents);

    await clickFirst(page, [/save/i, /submit/i, /add$/i, /continue/i], "Save/Submit");
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

    const uploadedAfterSave = await attachVisibleDocuments(page, this.options.config.documents);
    if (uploadedAfterSave) {
      await clickFirst(page, [/save/i, /submit/i, /upload/i, /continue/i], "document Save/Submit");
    }
  }

  private async openAndFillAddressForm(page: Page): Promise<void> {
    await clickFirst(page, [/add address/i, /add/i], "Add Address", this.options.logger);
    await dismissBlockingZoomPopups(page, this.options.logger);

    await chooseOptionFromCombobox(page, /Country\/Region/i, countryLabel(this.options.config.address.country));
    await chooseOptionFromCombobox(page, /Number Type & Capability/i, this.options.config.address.numberType);

    await fillField(page, [/address line 1/i, /street address/i, /^address$/i], this.options.config.address.line1);
    if (this.options.config.address.line2) {
      await fillField(page, [/address line 2/i, /suite|unit|apt/i], this.options.config.address.line2, false);
    }
    if (this.options.config.address.state) {
      await fillField(page, [/state\/province\/territory/i, /state|province|region/i], this.options.config.address.state, false);
    }
    await fillField(page, [/^city$/i], this.options.config.address.city);
    await fillField(page, [/zip|postal/i], this.options.config.address.postalCode);
    await fillField(page, [/customer name/i], this.options.config.address.customerName);
    await fillField(page, [/contact name/i], this.options.config.address.contactName, false);
    const contactNumber = await requireVisibleValue(
      page,
      [/contact number/i],
      this.options.config.address.contactNumber,
      "BUSINESS_ADDRESS_CONTACT_NUMBER"
    );
    if (contactNumber) {
      await fillField(page, [/contact number/i], contactNumber, false);
    }
    await fillField(page, [/contact email address/i, /contact email/i], this.options.config.address.contactEmail, false);
  }

  private async verifyAddressAdded(page: Page): Promise<void> {
    const successText = page.getByText(/success|saved|added/i).first();
    await successText.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    await this.openBusinessAddressPage(page);
    await dismissBlockingZoomPopups(page, this.options.logger);
    await expectAddressVisibleOnList(page, this.options.config.address);

    if (!(await this.addressAlreadyVisible(page))) {
      throw new Error("Could not verify that the business address was added");
    }
  }
}

async function fillField(page: Page, patterns: RegExp[], value: string, required = true): Promise<void> {
  const locator = await findField(page, patterns);
  if (!locator) {
    if (required) {
      throw new Error(`Could not find required field matching ${patterns.map(String).join(", ")}`);
    }
    return;
  }

  await locator.fill(value, { timeout: 5_000 });
}

async function requireVisibleValue(
  page: Page,
  patterns: RegExp[],
  value: string | undefined,
  envName: string
): Promise<string> {
  const locator = await findField(page, patterns);
  if (!locator) {
    return "";
  }
  if (!value) {
    throw new Error(`${envName} is required because Zoom rendered ${patterns.map(String).join(", ")}`);
  }
  return value;
}

async function chooseOptionFromCombobox(page: Page, comboboxName: RegExp, optionName: string): Promise<void> {
  const combobox = page.getByRole("combobox", { name: comboboxName }).first();
  await combobox.click({ timeout: 10_000 });
  await selectVisibleOption(page, optionName).catch(async () => {
    await combobox.fill(optionName, { timeout: 3_000 }).catch(async () => {
      await page.keyboard.type(optionName, { delay: 15 });
    });
    await selectVisibleOption(page, optionName);
  });
  await page.waitForTimeout(1_000);
}

async function selectVisibleOption(page: Page, optionName: string): Promise<void> {
  const option = page.getByRole("option", { name: optionNamePattern(optionName) }).first();
  await option.waitFor({ state: "visible", timeout: 5_000 });
  await option.click();
}

async function findField(page: Page, patterns: RegExp[]): Promise<Locator | undefined> {
  for (const pattern of patterns) {
    const candidates = [
      page.getByLabel(pattern).first(),
      page.getByPlaceholder(pattern).first(),
      page.getByRole("textbox", { name: pattern }).first(),
      page.getByRole("combobox", { name: pattern }).first()
    ];

    for (const candidate of candidates) {
      if (await candidate.isVisible({ timeout: 1_000 }).catch(() => false)) {
        return candidate;
      }
    }
  }

  return undefined;
}

async function attachVisibleDocuments(
  page: Page,
  documents: { required: boolean; idPath?: string; businessVerificationPath?: string }
): Promise<boolean> {
  const proofOfBusinessUpload = page.getByRole("button", { name: /proof of business.*upload/i }).first();
  if (await proofOfBusinessUpload.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const filePath = documents.businessVerificationPath ?? documents.idPath;
    if (!filePath) {
      throw new Error("DOCUMENT_BUSINESS_VERIFICATION_PATH is required because Zoom rendered Proof of Business upload");
    }
    await uploadViaButton(page, proofOfBusinessUpload, filePath);
    return true;
  }

  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();

  if (count === 0) {
    if (documents.required) {
      throw new Error("Could not find file upload inputs for required verification documents");
    }
    return false;
  }

  const filePaths = documentFilePaths(documents);
  if (filePaths.length === 0) {
    throw new Error("Document upload controls are visible, but no document paths are configured");
  }

  if (count === 1) {
    await inputs.first().setInputFiles(filePaths);
    return true;
  }

  await inputs.nth(0).setInputFiles(filePaths[0]);
  await inputs.nth(1).setInputFiles(filePaths[1] ?? filePaths[0]);
  return true;
}

function documentFilePaths(documents: { idPath?: string; businessVerificationPath?: string }): string[] {
  return [documents.idPath, documents.businessVerificationPath].filter((filePath): filePath is string =>
    Boolean(filePath)
  );
}

async function uploadViaButton(page: Page, button: Locator, filePath: string): Promise<void> {
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
  await button.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePath);
}

async function clickFirst(page: Page, patterns: RegExp[], description: string, logger?: Logger): Promise<void> {
  await dismissBlockingZoomPopups(page, logger);

  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await button.click().catch(async (error) => {
        if (!String(error).includes("intercepts pointer events")) {
          throw error;
        }
        await dismissBlockingZoomPopups(page, logger);
        await button.click();
      });
      return;
    }
  }

  throw new Error(`Could not find ${description} button`);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "_");
}

export function businessAddressAppearsInPageText(
  pageText: string,
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    numberType?: string;
  }
): boolean {
  const normalizedPageText = normalizeAddressText(pageText);
  const lineTokens = significantAddressTokens(address.line1);
  const secondaryTokens = address.line2 ? significantAddressTokens(address.line2) : [];
  const requiredTokens = [
    ...lineTokens,
    ...secondaryTokens,
    ...significantAddressTokens(address.city),
    ...(address.state ? significantAddressTokens(address.state) : []),
    normalizeCountry(address.country),
    normalizeAddressText(address.postalCode)
  ].filter(Boolean);

  if (!requiredTokens.every((token) => normalizedPageText.includes(token))) {
    return false;
  }

  return address.numberType ? pageTextContainsNumberType(pageText, address.numberType) : true;
}

export type BusinessAddressStatusResult =
  | { present: false; verificationStatus?: undefined }
  | { present: true; verificationStatus?: string };

export function findBusinessAddressStatusInPageText(
  pageText: string,
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    numberType?: string;
  }
): BusinessAddressStatusResult {
  if (!businessAddressAppearsInPageText(pageText, address)) {
    return { present: false };
  }

  return {
    present: true,
    verificationStatus: findVerificationStatus(addressNearbyText(pageText, address))
  };
}

function significantAddressTokens(value: string): string[] {
  return normalizeAddressText(value)
    .split(" ")
    .filter((token) => token.length > 1 || /\d/.test(token));
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  au: "australia",
  sg: "singapore",
  us: "united states",
  usa: "united states",
  gb: "united kingdom",
  uk: "united kingdom",
  nz: "new zealand",
  ca: "canada",
  in: "india",
  jp: "japan",
  de: "germany",
  fr: "france",
  nl: "netherlands",
  ie: "ireland",
  br: "brazil",
  mx: "mexico",
};

function normalizeCountry(country: string): string {
  const normalized = normalizeAddressText(country);
  return COUNTRY_CODE_MAP[normalized] ?? normalized;
}

export function countryLabel(country: string): string {
  const normalized = country.trim().toUpperCase();
  if (normalized === "AU") {
    return "Australia";
  }
  if (normalized === "SG") {
    return "Singapore";
  }
  if (normalized === "US" || normalized === "USA") {
    return "United States";
  }
  return country;
}

export function optionNamePattern(optionName: string): RegExp {
  const escaped = escapeRegExp(optionName);
  if (/^toll$/i.test(optionName)) {
    return /^Toll(?:\s|$)/i;
  }
  return new RegExp(`^${escaped}(?:\\s|$|-)`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[/,.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTextContainsNumberType(pageText: string, numberType: string): boolean {
  if (/^toll$/i.test(numberType)) {
    return /\bToll\b(?!-free)/i.test(pageText);
  }
  if (/^toll-free$/i.test(numberType)) {
    return /\bToll-free\b/i.test(pageText);
  }

  return new RegExp(`\\b${escapeRegExp(numberType)}\\b`, "i").test(pageText);
}

function addressNearbyText(
  pageText: string,
  address: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
  }
): string {
  const lowerPageText = pageText.toLowerCase();
  const anchors = [address.line1, address.line2, address.postalCode, address.city].filter(
    (value): value is string => Boolean(value)
  );
  const anchorIndex = anchors
    .map((anchor) => lowerPageText.indexOf(anchor.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (anchorIndex === undefined) {
    return pageText;
  }

  const start = Math.max(0, anchorIndex - 1_000);
  const end = Math.min(pageText.length, anchorIndex + 1_500);
  return pageText.slice(start, end);
}

function findVerificationStatus(text: string): string | undefined {
  const statuses: Array<[string, RegExp]> = [
    ["Verified", /\bverified\b/i],
    ["Pending", /\bpending\b/i],
    ["Rejected", /\brejected\b/i],
    ["Failed", /\bfailed\b/i],
    ["Approved", /\bapproved\b/i],
    ["Submitted", /\bsubmitted\b/i],
    ["In review", /\bin\s+review\b/i],
    ["Review required", /\breview\s+required\b/i],
    ["Not required", /\bnot\s+required\b/i]
  ];

  return statuses.find(([, pattern]) => pattern.test(text))?.[0];
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


async function expectAddressVisibleOnList(
  page: Page,
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    numberType?: string;
  }
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const pageText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (businessAddressAppearsInPageText(pageText, address)) {
      return;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("Could not verify that the business address appears on the list page");
}

