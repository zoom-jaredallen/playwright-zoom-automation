import type { Browser, BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { MASTER_REQUIRED_COOKIES, validateCookies } from "./cookies.js";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface LoginOptions {
  browser: Browser;
  config: AppConfig["zoom"];
  logger: Logger;
  timeoutMs?: number;
}

export async function loginAsMasterAdmin(options: LoginOptions): Promise<StorageState> {
  const context = await options.browser.newContext();
  const page = await context.newPage();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const baseUrl = options.config.webBaseUrl.replace(/\/$/, "");

  try {
    options.logger.info("Opening Zoom native sign-in page");
    await page.goto(`${baseUrl}/signin#/login`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await acceptCookies(page);

    options.logger.info("Submitting Zoom admin email");
    await page.locator('input#email, input[name="account"]').first().fill(options.config.adminEmail, {
      timeout: timeoutMs
    });
    await page.locator("#signin_btn_next").click({ timeout: timeoutMs });
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    assertNoUnsupportedSso(page.url(), baseUrl);

    options.logger.info("Submitting Zoom admin password");
    const passwordField = page.locator('input[type="password"], input[name="password"]').first();
    await passwordField.waitFor({ state: "visible", timeout: timeoutMs });
    await passwordField.fill(options.config.adminPassword, { timeout: timeoutMs });
    await clickSignIn(page, timeoutMs);

    await waitForAuthenticatedSession(page, baseUrl, timeoutMs);
    assertNoUnsupportedSso(page.url(), baseUrl);

    await validateCookies(context, MASTER_REQUIRED_COOKIES, [baseUrl]);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

export function isUnsupportedSsoUrl(currentUrl: string, zoomBaseUrl: string): boolean {
  const zoomHost = new URL(zoomBaseUrl).hostname;
  const currentHost = new URL(currentUrl).hostname;

  if (currentHost === zoomHost) {
    return false;
  }

  return currentHost.includes("okta.com") || currentHost === "success.zoom.us" || currentUrl.includes("/saml/");
}

async function acceptCookies(page: Page): Promise<void> {
  await page.getByRole("button", { name: /accept cookies|accept all cookies/i }).click({ timeout: 3_000 }).catch(
    () => undefined
  );
}

async function clickSignIn(page: Page, timeoutMs: number): Promise<void> {
  const signInButton = page.locator("#signin_btn, button:has-text('Sign in'), button:has-text('Sign In')").first();
  await signInButton.click({ timeout: timeoutMs });
}

async function waitForAuthenticatedSession(page: Page, baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    assertNoUnsupportedSso(page.url(), baseUrl);

    if (isAuthenticatedUrl(page.url(), baseUrl)) {
      return;
    }

    const currentText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const blockingReason = getZoomLoginBlockingReason(currentText);
    if (blockingReason) {
      throw new Error(blockingReason);
    }

    await page.waitForTimeout(500);
  }

  await page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
}

export function getZoomLoginBlockingReason(pageText: string): string | undefined {
  if (/entered the letters\s*\(captcha\)\s*incorrectly|captcha\s+(verification|required|incorrect)/i.test(pageText)) {
    return "Zoom native login requires CAPTCHA, which this automation does not bypass.";
  }

  if (/verification code|one-time|multi-factor|\bmfa\b/i.test(pageText)) {
    return "Zoom native login requires MFA/OTP, which is not implemented in this version.";
  }

  if (/incorrect email or password|wrong password|invalid password|invalid email/i.test(pageText)) {
    return "Zoom native login failed. Check the configured Zoom credentials.";
  }

  return undefined;
}

function isAuthenticatedUrl(currentUrl: string, baseUrl: string): boolean {
  return currentUrl.startsWith(`${baseUrl}/profile`) || currentUrl.startsWith(`${baseUrl}/account`);
}

function assertNoUnsupportedSso(currentUrl: string, baseUrl: string): void {
  if (!isUnsupportedSsoUrl(currentUrl, baseUrl)) {
    return;
  }

  throw new Error(
    `Zoom redirected to an unsupported SSO URL (${currentUrl}). This automation only supports native Zoom email/password login. Use a Zoom admin account that is not forced through SSO.`
  );
}
