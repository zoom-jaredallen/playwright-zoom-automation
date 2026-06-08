import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import {
  buildSelectorResolutionPlan,
  createSelectorResolutionDiagnostics,
  resolveSelector
} from "../src/runtime/selectors/selectorResolver.js";
import type { SelectorCandidate, SelectorStrategy } from "@zoom-automation/workflow-core";

const canRunBrowser = await chromium.launch({ headless: true })
  .then(async (browser) => {
    await browser.close();
    return true;
  })
  .catch(() => false);

describe("enterprise selector runtime", () => {
  it("builds a ranked resolution plan from candidates and legacy selectors", () => {
    const selectors: SelectorStrategy = { css: ".zoom-input__inner:nth-child(2)" };
    const candidates: SelectorCandidate[] = [
      { id: "css", kind: "css", selector: { css: ".zoom-input__inner:nth-child(2)" }, source: "recorded" },
      { id: "role-save", kind: "role", selector: { role: { role: "button", name: "Save", exact: true } }, source: "healed" }
    ];

    const plan = buildSelectorResolutionPlan(selectors, candidates);

    expect(plan.map((entry) => entry.candidate.kind)).toEqual(["role", "css"]);
    expect(plan[0].candidate.id).toBe("role-save");
    expect(plan[0].score.level).toBe("high");
  });

  it("records diagnostics for fallback usage and ambiguous matches", () => {
    const diagnostics = createSelectorResolutionDiagnostics({
      requestedStrategies: ["role-save", "css"],
      selectedStrategy: "css",
      selectedRank: 2,
      matchedCount: 4,
      visibleCount: 2,
      elapsedMs: 120,
      warnings: ["Ambiguous: 2 visible matches"]
    });

    expect(diagnostics.fallbackUsed).toBe(true);
    expect(diagnostics.confidence).toBe("medium");
    expect(diagnostics.warnings).toContain("Ambiguous: 2 visible matches");
  });

  (canRunBrowser ? it : it.skip)("does not apply stale legacy nth values to ranked fallback candidates", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <div id="wizard-get-number-2">Get Number</div>
        </main>
      `);

      const selectors: SelectorStrategy = {
        role: { role: "menuitem" },
        text: "Get Number",
        css: "#missing-recorded-selector",
        nth: 112
      };
      const candidates: SelectorCandidate[] = [
        {
          id: "css-wizard-get-number-2",
          kind: "css",
          selector: { css: "#wizard-get-number-2" },
          source: "recorded"
        }
      ];

      const result = await resolveSelector(page, selectors, candidates, 1_000);

      await expect(result.locator.textContent()).resolves.toBe("Get Number");
      expect(result.diagnostics.selectedStrategy).toBe("css-wizard-get-number-2");
    } finally {
      await browser.close();
    }
  });
});
