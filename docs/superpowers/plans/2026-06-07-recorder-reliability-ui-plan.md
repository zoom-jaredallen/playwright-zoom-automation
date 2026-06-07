# Recorder Reliability And Operations UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Visual Step Inspector, Assertion Builder, Smart Selector Repair, Run Cockpit, and Workflow Parameter UI improvements that make recorded workflows easier to trust, repair, and run at scale.

**Architecture:** Keep workflow schema and selector scoring in `packages/workflow-core`, browser-only DOM inspection in `extension/content`, recorder authoring UI in `extension/sidepanel`, compiled Playwright behavior in `src/compiler`, and run observability in `src/server` plus `src/ui`. Avoid god modules by introducing focused services for screenshots, selector diagnostics, assertions, cockpit metrics, and parameter schemas.

**Tech Stack:** TypeScript, React, Express, Playwright, Chrome Extension Manifest V3, Vitest, PRISM-inspired CSS tokens.

---

## Current Foundations

- `packages/workflow-core/src/types.ts` already owns `RecordedAction`, `SelectorStrategy`, `SelectorCandidate`, `WorkflowParameter`, and assertion types.
- `extension/shared/selectorCandidates.ts` can rank/test selector candidates against the current DOM.
- `extension/shared/selectorRepair.ts` can apply preferred selector candidates but needs richer repair orchestration.
- `extension/sidepanel/sidepanel.ts` already supports action editing, selector testing, manual insertion, test runs, and quality reports.
- `src/compiler/selectorHealing.ts` and `src/compiler/compiler.ts` already compile recorded workflows and should become consumers of the same selector diagnostics.
- `src/ui/components/RunMonitor.tsx`, `src/ui/components/RunAccountTimeline.tsx`, and `/api/operations` provide the starting point for a richer Run Cockpit.
- `src/ui/components/WorkflowParameterForm.tsx` and `src/server/services/workflowParameterService.ts` already expose basic workflow parameters.

## Phase 1: Shared Authoring Metadata And Assertion Schema

**Outcome:** Recorded actions can store screenshot evidence, target bounding boxes, selector diagnostics, repair suggestions, assertion details, and parameter metadata without extension-only side channels.

**Files:**
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `packages/workflow-core/src/schema.ts`
- Modify: `packages/workflow-core/src/confidence.ts`
- Modify: `packages/workflow-core/src/analysis.ts`
- Modify: `extension/shared/types.ts`
- Test: `tests/workflowCore.test.ts` or create `packages/workflow-core/src/__tests__/authoringMetadata.test.ts`

**Data model additions:**
- `RecordedAction.capture?: StepCapture`
- `RecordedAction.selectorDiagnostics?: SelectorDiagnosticsSummary`
- `RecordedAction.repairSuggestions?: SelectorRepairSuggestion[]`
- `WorkflowParameter.ui?: WorkflowParameterUiHint`
- Extend `AssertionType` with `toastVisible`, `urlMatches`, and `addressStatusEquals`.

**New types:**
- `StepCapture`: thumbnail data URL reference, screenshot artifact id, page URL, viewport, target box, capturedAt.
- `SelectorDiagnosticsSummary`: matched count, visible count, chosen candidate id, confidence score, confidence level, target preview, anchor summary.
- `SelectorRepairSuggestion`: candidate id, selector, source, score, reasons, matched count, visible count, risk level.
- `WorkflowParameterUiHint`: group, label, helpText, placeholder, secret, multiline, fileAccept, accountOverrideAllowed.

**Acceptance criteria:**
- Existing workflow JSON remains valid.
- New workflow JSON validates with capture, diagnostics, repair suggestions, and rich parameter UI hints.
- Quality report scoring can account for missing assertions and low-confidence selectors using the new metadata.

**Verification:**
- `npm run build:core`
- `npm test -- packages/workflow-core`
- `npm run typecheck`

**Commit:** `feat: add workflow authoring metadata schema`

## Phase 2: Visual Step Inspector In Chrome Extension

**Outcome:** Selecting a step in the side panel shows a compact inspector with recorded screenshot thumbnail, target highlight, selector stack, anchor relationship, live match counts, and confidence score.

**Files:**
- Create: `extension/content/stepCapture.ts`
- Create: `extension/content/elementOverlay.ts`
- Create: `extension/shared/stepInspector.ts`
- Create: `extension/sidepanel/components` only if the side panel is split during implementation; otherwise keep functions focused inside `sidepanel.ts`.
- Modify: `extension/content/recorder.ts`
- Modify: `extension/background/service-worker.ts`
- Modify: `extension/sidepanel/sidepanel.ts`
- Modify: `extension/sidepanel/sidepanel.css`
- Test: `extension/shared/stepInspector.test.ts`

**Implementation notes:**
- Capture target metadata at recording time: viewport, element bounding box, accessible preview, selector candidates, selected candidate id, and page URL.
- Capture screenshot thumbnail through the extension background using `chrome.tabs.captureVisibleTab`; store a compressed data URL or artifact-like local value in the workflow JSON.
- Add a content-script overlay command that highlights the current chosen element and optionally each fallback candidate.
- Add sidepanel inspector sections:
  - Evidence thumbnail.
  - Chosen selector.
  - Fallback selectors with score chips.
  - Anchor relationship summary.
  - Live diagnostics: matched count, visible count, chosen preview.
  - Confidence score and reasons.

**Acceptance criteria:**
- Clicking a workflow step opens the inspector near that step, without forcing the user to scroll to the bottom.
- The current page target can be highlighted from the inspector.
- Live selector diagnostics refresh on demand.
- CSS-only selectors show a warning state.
- Missing screenshots degrade gracefully with a neutral empty state.

**Verification:**
- `cd extension && npx tsc --noEmit`
- `cd extension && npm run build`
- Manual load extension, record a short flow, select a step, verify thumbnail and highlight.

**Commit:** `feat: add visual step inspector`

## Phase 3: Assertion Builder

**Outcome:** Users can add and configure first-class verify steps for text, elements, fields, rows, address status, URL, and toast/banner messages. The compiler and test runner execute these assertions consistently.

**Files:**
- Create: `extension/shared/assertionCatalog.ts`
- Create: `src/compiler/assertionCompiler.ts`
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `extension/sidepanel/sidepanel.ts`
- Modify: `extension/sidepanel/sidepanel.css`
- Modify: `extension/content/recorder.ts`
- Modify: `src/compiler/compiler.ts`
- Modify: `src/compiler/conditionalLogic.ts`
- Test: `tests/assertionCompiler.test.ts`
- Test: `extension/shared/assertionCatalog.test.ts`

**Supported assertions:**
- Text exists: `expect(page.getByText(expected)).toBeVisible()`
- Element visible: selected strategy compiles to locator visibility.
- Field value equals: locator value comparison.
- Row contains value: row anchor plus expected text.
- Address status equals: shared status parser where possible, with status label fallback.
- URL matches: exact, contains, or regex mode.
- Toast/banner appears: role/status/alert plus visible text fallback.

**Acceptance criteria:**
- Assertion actions appear as verify steps, visually distinct from mutation steps.
- Assertion builder exposes only relevant fields for the chosen assertion type.
- Assertion steps can be inserted between existing steps.
- Test workflow mode reports assertion failures as assertion failures, not generic selector failures.
- Quality report assertion coverage improves when verify steps are present.

**Verification:**
- `npm test -- tests/assertionCompiler.test.ts`
- `cd extension && npm test -- assertionCatalog` if extension test script exists; otherwise `cd extension && npx tsc --noEmit`
- `npm run build`
- `cd extension && npm run build`

**Commit:** `feat: add recorded workflow assertion builder`

## Phase 4: Smart Selector Repair

**Outcome:** When a selector fails or has low confidence, the extension and runtime test alternatives, rank them, and present a repair action that can update the step.

**Files:**
- Create: `packages/workflow-core/src/selectorRepair.ts`
- Create: `extension/content/selectorDiagnostics.ts`
- Create: `extension/shared/selectorRepairPlan.ts`
- Modify: `extension/shared/selectorCandidates.ts`
- Modify: `extension/shared/selectorRepair.ts`
- Modify: `extension/sidepanel/sidepanel.ts`
- Modify: `src/compiler/selectorHealing.ts`
- Test: `tests/selectorRepairRuntime.test.ts`
- Test: `extension/shared/selectorRepairPlan.test.ts`

**Repair strategy order:**
- ARIA role/name.
- Label.
- Placeholder or accessible description.
- Test id.
- Exact visible text.
- Nearby stable text plus relative target.
- XPath scoped to a stable anchor.
- CSS as last resort.

**Runtime behavior:**
- On failure, test all candidates against the current page.
- Prefer candidates with one visible match and target-like role/tag compatibility.
- Preserve anchors when they reduce match count.
- Store chosen repair in `repairSuggestions`.
- In test mode, allow one-click “Apply repair”.
- In bulk run mode, log repair candidates but do not mutate workflow files automatically.

**Acceptance criteria:**
- Failed selector tests return ranked repair candidates with reasons.
- The inspector shows repair suggestions and applies one safely.
- Compiler uses the same ranking helpers as the extension.
- Bulk run artifacts include selector diagnostics when a step fails.

**Verification:**
- `npm test -- tests/selectorRepairRuntime.test.ts`
- `npm run build:core`
- `npm run typecheck`
- `cd extension && npm run build`

**Commit:** `feat: add smart selector repair`

## Phase 5: Workflow Parameter UI

**Outcome:** Recorded workflows expose clean parameter forms for reusable values and account-level overrides instead of hardcoded values.

**Files:**
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `extension/shared/parameterizer.ts`
- Modify: `src/server/services/workflowParameterService.ts`
- Modify: `src/ui/components/WorkflowParameterForm.tsx`
- Create: `src/ui/components/AccountOverrideGrid.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/api.ts`
- Test: `tests/workflowParameterService.test.ts`
- Test: UI tests if the project adds React test infrastructure; otherwise cover pure helpers and build.

**Parameter groups:**
- Business identity: company name, expected status.
- Address: country, address line, city, state, postal code, number type.
- Documents: file uploads, document labels, required flag.
- Account override values: per-account replacement values.

**Acceptance criteria:**
- Imported workflows show detected parameters grouped by purpose.
- File parameters use file inputs and preserve path/value semantics expected by the runner.
- Parameters can be set globally and overridden per account.
- Run readiness blocks runs when required parameters are missing.
- Existing address-profile workflow behavior remains unchanged.

**Verification:**
- `npm test -- tests/workflowParameterService.test.ts`
- `npm run typecheck`
- `npm run build:ui`

**Commit:** `feat: improve workflow parameter authoring`

## Phase 6: Run Cockpit

**Outcome:** The Web UI run monitor becomes an operational cockpit for live queue progress, current accounts, workers, retries, failure categories, filters, and bulk actions.

**Files:**
- Create: `src/server/services/runCockpitService.ts`
- Modify: `src/server/app.ts`
- Modify: `src/ui/api.ts`
- Create: `src/ui/components/RunCockpit.tsx`
- Create: `src/ui/components/RunFilterBar.tsx`
- Create: `src/ui/components/FailureCategoryPanel.tsx`
- Create: `src/ui/components/WorkerHealthPanel.tsx`
- Modify: `src/ui/components/RunMonitor.tsx`
- Modify: `src/ui/styles.css`
- Test: `tests/runCockpitService.test.ts`

**Cockpit sections:**
- Live progress: queued, leased, running, retrying, completed, skipped, failed.
- Current activity: account name, workflow, step message, elapsed duration.
- Worker/session health: active workers, stale workers, lease counts, last heartbeat.
- Retry activity: retry attempts by account and workflow.
- Failure breakdown: login, impersonation, selector, assertion, upload, timeout, Zoom popup, unknown.
- Filters: failed, skipped, needs review, no address found, running, completed.
- Bulk actions: retry failed, retry skipped, export report, open trace list.

**Acceptance criteria:**
- Existing run start controls remain available.
- Large runs are scannable without scrolling through every account first.
- Filters apply instantly to the account list.
- Bulk retry creates a retry job using existing retry endpoints.
- Export report uses the manifest/report infrastructure instead of only client-side CSV.

**Verification:**
- `npm test -- tests/runCockpitService.test.ts`
- `npm run typecheck`
- `npm run build:ui`
- Browser smoke test at `http://localhost:4174/` if the server is running.

**Commit:** `feat: add run cockpit`

## Phase 7: End-To-End Integration Hardening

**Outcome:** The five features work together across record, inspect, test, import, run, repair, and report flows.

**Files:**
- Modify focused files only where integration gaps are found.
- Add tests under `tests/` for cross-surface contracts.

**Integration checks:**
- Record a workflow with captures and selector candidates.
- Add assertions in the side panel.
- Test selectors and apply a repair.
- Import workflow into Web UI.
- Configure global parameters and account overrides.
- Run in dry-run mode.
- Inspect Run Cockpit progress, failure categories, artifacts, and export report.

**Verification:**
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run build:ui`
- `cd extension && npm run build`

**Commit:** `chore: harden recorder reliability integration`

## Recommended Implementation Order

1. Phase 1, because all other surfaces need a shared schema.
2. Phase 2, because it gives immediate visibility into recorded steps.
3. Phase 4, because selector repair builds directly on inspector diagnostics.
4. Phase 3, because assertions rely on the same selector and target configuration.
5. Phase 5, because reusable workflows need parameter contracts before bulk runs.
6. Phase 6, because the cockpit benefits from richer runtime data.
7. Phase 7, because the final pass should validate the complete loop.

## Risks And Mitigations

- Screenshot storage could make workflow JSON too large. Mitigate by storing thumbnails only in the extension and using artifact references for larger evidence.
- Chrome extension APIs may be unavailable in some browsers. Feature-detect screenshot and overlay capabilities and show a clear disabled state.
- XPath repair can become brittle. Keep XPath below semantic selectors and flag it as medium or low confidence unless scoped by a stable anchor.
- Assertion Builder could become too broad. Start with the seven requested assertion types only.
- Run Cockpit could become a large component. Split metrics, filters, worker health, failure categories, and account table into focused components.

## Definition Of Done

- Recorder users can inspect and repair a selected step without scrolling away from that step.
- Verify steps are first-class, compiled, testable, and included in quality reports.
- Selector failures produce actionable repair candidates in test mode and diagnostics in bulk mode.
- Run Cockpit makes a 50-account or 500-account run understandable at a glance.
- Workflow parameters are reusable, grouped, validated, and support per-account overrides.
- All root and extension build/type/test checks pass.
