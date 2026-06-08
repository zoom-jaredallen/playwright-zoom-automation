import { isElementVisible, sleep, visibleText } from "./domHelpers.js";

const PAGE_READY_QUIET_MS = 450;
const PAGE_READY_INITIAL_SETTLE_MS = 150;
const PAGE_READY_LOADING_SELECTORS = [
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

export async function waitForPageReady(timeout: number, options: { afterAction?: boolean } = {}): Promise<void> {
  const deadline = Date.now() + Math.max(timeout, 1_000);
  if (options.afterAction) {
    await sleep(PAGE_READY_INITIAL_SETTLE_MS);
  }

  await waitForDocumentComplete(deadline);
  await waitForNoVisibleLoading(deadline);
  if (options.afterAction) return;
  await waitForDomQuiet(deadline, PAGE_READY_QUIET_MS);
}

async function waitForDocumentComplete(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      return;
    }
    await sleep(50);
  }
  throw new Error("Page did not reach a ready document state before the step timeout.");
}

async function waitForNoVisibleLoading(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (!hasVisibleLoadingIndicator()) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Page still shows a loading indicator after the step timeout.");
}

async function waitForDomQuiet(deadline: number, quietMs: number): Promise<void> {
  let lastMutation = Date.now();
  const observer = new MutationObserver(() => {
    lastMutation = Date.now();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  try {
    while (Date.now() < deadline) {
      if (Date.now() - lastMutation >= quietMs && !hasVisibleLoadingIndicator()) {
        return;
      }
      await sleep(75);
    }
  } finally {
    observer.disconnect();
  }

  throw new Error("Page did not settle before the step timeout.");
}

function hasVisibleLoadingIndicator(): boolean {
  return Array.from(document.querySelectorAll(PAGE_READY_LOADING_SELECTORS)).some((element) => {
    if (!isElementVisible(element)) return false;
    const text = visibleText(element).toLowerCase();
    if (text.includes("loaded") || text.includes("not loading")) return false;
    return true;
  });
}
