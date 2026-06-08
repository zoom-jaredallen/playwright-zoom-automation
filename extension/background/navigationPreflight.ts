import type { ExtensionMessage, RecordedAction } from "../shared/types.js";
import { normalizeNavigationUrl } from "@zoom-automation/workflow-core";
import { ensureContentRecorder, sleep } from "./chromeTabUtils.js";

export async function evaluatePreflightNavigation(
  tabId: number,
  action: RecordedAction
): Promise<{ message: string; navigated: boolean; targetUrl?: string }> {
  const targetUrl = normalizeNavigationUrl(action.url ?? action.pageUrl ?? "/");
  const target = parseUrl(targetUrl);
  if (!target || !isZoomUrl(target)) {
    throw new Error("Navigation preflight only supports Zoom URLs to avoid leaving the impersonated session context.");
  }

  const currentTab = await chrome.tabs.get(tabId).catch(() => undefined);
  const currentUrl = currentTab?.url ?? "";
  const current = parseUrl(currentUrl);
  if (!current || !isZoomUrl(current)) {
    throw new Error("Open a Zoom tab in the impersonated account before running preflight navigation.");
  }

  const expectedFragment = action.waitForUrl ?? safeNavigationFragment(targetUrl);

  if (expectedFragment && currentUrl.includes(expectedFragment)) {
    return { message: "Navigation step already matches the current page; no tab navigation needed.", navigated: false };
  }

  await chrome.tabs.update(tabId, { url: targetUrl });
  return {
    message: `Navigating active Zoom tab to ${target.pathname}${target.hash || ""}.`,
    navigated: true,
    targetUrl
  };
}

export async function waitForPreflightNavigation(tabId: number, targetUrl: string): Promise<void> {
  const expectedFragment = safeNavigationFragment(targetUrl);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const url = tab?.url ?? "";
    if (expectedFragment && url.includes(expectedFragment) && tab?.status === "complete") {
      return;
    }
    if (!expectedFragment && tab?.status === "complete") {
      return;
    }
    await sleep(250);
  }

  throw new Error("Navigation did not finish before the preflight timeout.");
}

export async function waitForTestPageReady(tabId: number, timeout: number): Promise<void> {
  await ensureContentRecorder(tabId);
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "WAIT_FOR_PAGE_READY",
    timeout,
    afterAction: true
  } satisfies ExtensionMessage);
  if (!result?.ok) {
    throw new Error(result?.error ?? "Page did not become ready before the step timeout.");
  }
}

function safeNavigationFragment(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hash || parsed.pathname || undefined;
  } catch {
    return undefined;
  }
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isZoomUrl(url: URL): boolean {
  return url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us");
}
