import type { BrowserContext, Page } from "playwright";
import type { SubAccount } from "../automation/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { IMPERSONATION_REQUIRED_COOKIES, validateCookies } from "./cookies.js";

export interface ImpersonationOptions {
  context: BrowserContext;
  page: Page;
  account: SubAccount;
  config: AppConfig["zoom"];
  logger: Logger;
  timeoutMs?: number;
}

export async function impersonateSubAccount(options: ImpersonationOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const baseUrl = options.config.webBaseUrl.replace(/\/$/, "");
  const impersonationUrl = `${baseUrl}/account/sub/${encodeURIComponent(options.account.id)}/login`;

  options.logger.info("Impersonating Zoom sub account", {
    accountId: options.account.id,
    accountName: options.account.name
  });

  const response = await options.context.request.get(impersonationUrl, { timeout: timeoutMs });
  if (!response.ok()) {
    const error = new Error(`Zoom sub-account impersonation failed with status ${response.status()}`);
    Object.assign(error, { retryable: response.status() === 429 || response.status() >= 500 });
    throw error;
  }

  const finalUrl = response.url();
  if (finalUrl.includes("/signin")) {
    throw new Error("Zoom redirected to sign-in during sub-account impersonation");
  }

  await options.page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  const pageContent = await options.page.content();
  const urlLooksImpersonated = finalUrl.includes("submanage") || options.page.url().includes("submanage");
  const contentLooksImpersonated = pageContent.includes("Not a master account");

  if (!urlLooksImpersonated && !contentLooksImpersonated) {
    throw new Error(`Zoom did not enter sub-account context. Final URL: ${finalUrl}`);
  }

  await validateCookies(options.context, IMPERSONATION_REQUIRED_COOKIES, [baseUrl]);
}
