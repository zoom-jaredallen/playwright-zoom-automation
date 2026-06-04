import type { Page } from "playwright";
import type { Logger } from "../logger.js";

export const DISMISSIBLE_POPUP_PATTERN =
  /custom ai companion|what'?s new|new .*available|announcement|introducing/i;

export function isDismissibleZoomDialogText(text: string): boolean {
  return DISMISSIBLE_POPUP_PATTERN.test(text);
}

export async function dismissBlockingZoomPopups(page: Page, logger?: Logger): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);

  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
      continue;
    }

    const ariaLabel = await dialog.getAttribute("aria-label").catch(() => "");
    const text = await dialog.innerText({ timeout: 1_000 }).catch(() => "");
    const dialogText = `${ariaLabel ?? ""}\n${text}`;
    if (!isDismissibleZoomDialogText(dialogText)) {
      continue;
    }

    const button = dialog
      .getByRole("button", { name: /close|got it|ok|dismiss|not now|skip|maybe later|done|cancel/i })
      .first();
    if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await button.click().catch(() => undefined);
      logger?.info("Dismissed Zoom popup", { dialog: firstLine(dialogText) });
      await page.waitForTimeout(500);
      continue;
    }

    await dialog
      .locator("button")
      .last()
      .click({ timeout: 1_000 })
      .catch(() => undefined);
    logger?.info("Dismissed Zoom popup with fallback button", { dialog: firstLine(dialogText) });
  }

  // evaluateAll runs in the browser context — pass the pattern source as a string
  await page
    .locator(".fe-popups-overlay")
    .evaluateAll(
      (overlays, patternSource) => {
        const re = new RegExp(patternSource, "i");
        for (const overlay of overlays) {
          const text = `${overlay.getAttribute("aria-label") ?? ""}\n${overlay.textContent ?? ""}`;
          if (re.test(text)) {
            overlay.remove();
          }
        }
      },
      DISMISSIBLE_POPUP_PATTERN.source
    )
    .catch(() => undefined);
}

function firstLine(value: string): string {
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}
