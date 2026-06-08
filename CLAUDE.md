# CLAUDE.md

Claude and other coding assistants should follow `AGENTS.md` as the canonical project guide.

## Quick Context

This repo is a TypeScript + Playwright Zoom automation app with a standalone React/Express UI. It automates Zoom master-account tasks across sub accounts using:

- Zoom API for sub-account discovery.
- Native Zoom web login for master-admin browser state.
- Cookie-backed web impersonation for each sub account.
- A fresh Playwright browser context per account.

Current surfaces include:

- CLI batch automation for configured Zoom Phone business-address flows.
- Web UI for account query, account selection, workflow selection, run monitoring, job history, and recorded-workflow import/editing.
- Chrome recorder extension for capturing Zoom UI workflows, testing selectors, adding manual steps, running browser preflight tests, and exporting/syncing workflow JSON.
- Recorder debug bridge and CLI for inspecting recorded workflows, queued browser-preflight tests, events, and workflow exports without visual browser control.
- Recorded-workflow compiler with selector healing, per-step retry/timeout policy, conditional guards, and generated quality reports.
- Artifact browser links in the web run monitor for traces, screenshots, failure details, and logs.

## Start Here

Read:

1. `AGENTS.md`
2. `README.md`
3. The relevant files under `src/automation/`, `src/zoom/`, `src/server/`, or `src/ui/` for the current task.

## Verification Checklist

Run the smallest useful check first, then broader checks before claiming completion.

```bash
npm test
npm run typecheck
npm run build
npm run build:ui
npm run check:file-size
```

For UI-only edits, also inspect the app at:

```bash
UI_PORT=4174 npm run dev
```

For Chrome extension edits:

```bash
cd extension
npx tsc --noEmit
npm run build
```

For recorder debugging, prefer the structured bridge before browser/computer-control tools:

```bash
UI_PORT=4174 npm run dev
npm run recorder:latest
npm run recorder:workflow
npm run recorder:actions
npm run recorder:test
npm run recorder:test -- --from step_id
npm run recorder:train -- --iterations 3 --stop-on-failure
npm run recorder:report
npm run recorder:audit
npm run recorder:debug -- harden --file output/debug/workflow.json
npm run recorder:debug -- harden --file output/debug/workflow.json --out output/debug/workflow.hardened.json
npm run recorder:diff
npm run recorder:bundle -- --out output/debug/latest-recorder-bundle
npm run recorder:export -- --out output/debug/workflow.json
```

The expected bridge workflow is:

1. Start the local server.
2. Reload the unpacked Chrome extension from `extension/dist/`.
3. Record or import the workflow in the active Zoom tab.
4. Use `npm run recorder:latest`, `npm run recorder:actions`, and `npm run recorder:workflow` to inspect structured state.
5. Use `npm run recorder:test` or `npm run recorder:test -- --from step_id` to enqueue browser-preflight replay in the active Chrome tab.
6. Use `npm run recorder:train -- --iterations 3 --stop-on-failure` for repeated training runs that identify flaky steps before bulk use.
7. Use `npm run recorder:report`, `npm run recorder:audit`, `npm run recorder:diff`, and `npm run recorder:bundle` to review the resulting workflow quality.
8. Use `npm run recorder:debug -- harden --file workflow.json` to preview reusable hardening without Chrome. Use `--out` to write the hardened JSON.

Recorder snapshots are written under `output/recorder-sessions/`. They include raw actions, prepared/deduped actions, workflow JSON, quality data, URL/title, and preflight events. They are diagnostics, may contain recorded field values, and should not be committed.

Training runs execute the recorded workflow against the active Zoom tab and may mutate the lab account. Only run them when the user has explicitly authorized testing and the Zoom page has been manually reset to the expected starting state.

Only fall back to browser/computer-control tools when the bridge cannot answer the question, such as recording a new unknown path, visual layout inspection, or clearing an unexpected Zoom modal.

Known verification caveat: untracked generated workflows under `src/workflows/recorded/` can make root `npm run typecheck` fail. Do not delete or commit those generated workflows unless the user explicitly asks.

Authored TypeScript files should stay at or below 600 lines. `npm run check:file-size` reports violations and excludes generated recorded workflows. Keep modules named around concrete responsibilities rather than creating catch-all utility files.

## Do Not Do These

- Do not expose `.env` values.
- Do not bypass CAPTCHA, MFA, or SSO.
- Do not run live Zoom automation unless the user explicitly asks.
- Do not copy from `reference/` blindly. It is historical context only.
- Do not change the cookie-backed impersonation model unless the user asks for a new authentication strategy.
- Do not commit generated workflows from `src/workflows/recorded/` unless the user explicitly wants them included.

## Implementation Notes

- Add new automations as `AutomationFlow` implementations.
- Register UI workflows in `src/server/services/workflowRegistry.ts`.
- Instantiate runnable workflows in `src/server/services/jobRunner.ts`.
- Use `src/server/services/artifacts.ts` for run artifact indexing instead of inventing ad hoc artifact links.
- The recorded-workflow schema, Zod validator, mutation model, and analysis/quality logic live in the shared `packages/workflow-core` package (`@zoom-automation/workflow-core`). Edit them there; `extension/shared/types.ts`, `src/compiler/types.ts`, and `src/ui/api.ts` re-export from it. The extension and Web UI drive the same `model`/`analysis` functions, gated by `WorkflowEditorCapabilities` (record/preflight are extension-only).
- Reusable recorder hardening lives in `packages/workflow-core/src/hardening/`. Keep the engine generic: infer intent, entity fingerprint, idempotency guards, outcome assertions, mutation retry policy, and bulk-readiness reports for create/update/delete/assign/remove/verify workflows. Put Zoom-specific behavior in the Zoom adapter, not in business-address-only branches.
- Web UI imports and recorded-workflow saves call `src/server/services/workflowHardeningService.ts` before compilation. Fresh recorder exports are hardened by `buildWorkflow()` in workflow-core.
- The compiler/runtime supports generic `entityStateGuard`, `entityExists`, `entityAbsent`, and `entityState`. Preserve these when editing `src/compiler/compiler.ts` or `src/compiler/assertionCompiler.ts`.
- This is an npm-workspace monorepo (`packages/*`, `extension`). Run `npm install` once at the root; `workflow-core` is built automatically before typecheck/test/build via `pre*` scripts.
- Preserve selector-healing and step-policy behavior when modifying `src/compiler/compiler.ts`.
- Keep country-specific address and document requirements in `addresses.yaml` when possible.
- Keep UI changes consistent with the existing PRISM-inspired standalone app styling.
