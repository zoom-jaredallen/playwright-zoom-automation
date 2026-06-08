export function generateHealingCode(): string {
  return `
  private healingReport: Array<{ actionDescription: string; originalStrategy: string; healedStrategy: string; confidence: number }> = [];

  private async writeSelectorDiagnostics(artifactBase: string, error?: unknown): Promise<void> {
    const payload = {
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error ?? "") },
      healingReport: this.healingReport
    };
    await writeFile(\`\${artifactBase}-selector-diagnostics.json\`, JSON.stringify(payload, null, 2), "utf8");
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
    const esc = (value: string) => value.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");

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

    throw new Error(\`Element not found with any selector strategy: \${JSON.stringify({ selectors, selectorCandidates })}\`);
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
          name: \`\${labelPrefix}:role:\${role}[\${name ?? ""}]\`,
          locator: () => pick(scope.getByRole(role, opts))
        });
      }
      if (source.label) {
        strategies.push({
          name: \`\${labelPrefix}:label:\${source.label}\`,
          locator: () => pick(scope.getByLabel(new RegExp(esc(source.label), "i")))
        });
      }
      if (source.text) {
        strategies.push({
          name: \`\${labelPrefix}:text:\${source.text}\`,
          locator: () => pick(scope.getByText(new RegExp(esc(source.text), "i")))
        });
      }
      if (source.testId) {
        strategies.push({ name: \`\${labelPrefix}:testId:\${source.testId}\`, locator: () => pick(scope.getByTestId(source.testId)) });
      }
      if (source.css) {
        strategies.push({ name: \`\${labelPrefix}:css:\${source.css}\`, locator: () => pick(scope.locator(source.css)) });
      }
      if (source.xpath) {
        strategies.push({ name: \`\${labelPrefix}:xpath\`, locator: () => pick(scope.locator(\`xpath=\${source.xpath}\`)) });
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

    const optionText = selectMetadata.optionLabel ?? value;
    const trigger = await this.findSelectTrigger(el);
    await trigger.click({ timeout });
    await this.filterOpenSelectIfEditable(trigger, optionText).catch(() => undefined);
    const popup = await this.findOpenSelectPopup(page, trigger, root, timeout, selectMetadata.popupSelectorHint);
    const optionCandidates = selectMetadata.optionCandidates ?? [];
    const optionSelectors = optionCandidates[0]?.selector ?? { role: { role: "option", name: optionText } };
    const option = optionCandidates.length > 0
      ? await this.findElement(popup, optionSelectors, optionCandidates, Math.min(timeout, 5_000))
          .catch(() => this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000)))
      : await this.findVisibleSelectOptionByText(page, popup, optionText, Math.min(timeout, 5_000));
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    const verificationText = selectMetadata.verificationText ?? optionText;
    await trigger.filter({ hasText: new RegExp(verificationText.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i") }).waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
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
    const escaped = optionText.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\s+/g, "\\\\s+");
    const exact = new RegExp("^\\\\s*" + escaped + "\\\\s*$", "i");
    const loose = new RegExp(escaped, "i");
    const optionSelector = [
      "[role='option']",
      "li",
      "[class*='option']",
      "[data-testid*='Option']",
      "[data-testid*='option']"
    ].join(", ");

    const allowLoose = optionText.trim().split(/\\s+/).filter(Boolean).length > 1;
    for (const scope of [popup]) {
      const exactOption = scope.locator(optionSelector).filter({ hasText: exact }).first();
      if (await exactOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return exactOption;

      const looseOption = scope.locator(optionSelector).filter({ hasText: loose }).first();
      if (allowLoose && await looseOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return looseOption;
    }

    const roleOption = page.getByRole("option", { name: loose }).first();
    if (await roleOption.isVisible({ timeout: Math.min(timeout, 1_500) }).catch(() => false)) return roleOption;

    throw new Error('No visible select option matching "' + optionText + '"');
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
      const controlled = page.locator(\`#\${controlledId.replace(/"/g, "\\\\\\"")}\`).first();
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
        if (await popup.isVisible({ timeout: 100 }).catch(() => false)) return popup;
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
    await download.saveAs(\`\${artifactBase}-\${suggested}\`);
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
    const esc = (value: string) => value.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
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
`;
}
