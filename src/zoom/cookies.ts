import type { BrowserContext } from "playwright";

export const MASTER_REQUIRED_COOKIES = ["cred", "zm_cluster", "zm_aid", "zm_haid", "_zm_page_auth"];

export const IMPERSONATION_REQUIRED_COOKIES = [
  "cred",
  "zm_cluster",
  "zm_aid",
  "zm_haid",
  "_zm_page_auth",
  "_zm_login_acctype"
];

export async function validateCookies(
  context: BrowserContext,
  requiredCookieNames: string[],
  urls = ["https://zoom.us", "https://zoom.com"]
): Promise<void> {
  const cookies = await context.cookies(urls);
  const names = new Set(cookies.map((cookie) => cookie.name));
  const missing = requiredCookieNames.filter((name) => !names.has(name));

  if (missing.length > 0) {
    const error = new Error(`Missing required Zoom cookies: ${missing.join(", ")}`);
    Object.assign(error, { retryable: true });
    throw error;
  }
}
