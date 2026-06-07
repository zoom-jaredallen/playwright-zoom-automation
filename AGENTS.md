# AGENTS.md

Guidance for LLM coding agents working on this project.

## Project Summary

This is a TypeScript automation app for Zoom master accounts. It combines:

- A CLI batch runner for Zoom sub-account automation.
- A standalone React + Express web UI for querying sub accounts, selecting workflows, and monitoring runs.
- Playwright browser flows for Zoom Admin web UI actions that cannot be completed through the Zoom API alone.

The app currently supports:

- Adding configured Zoom Phone business addresses.
- Checking whether a configured business address exists and reporting its current status.
- Recording/importing custom Zoom UI workflows through the Chrome extension and compiling them into workflow plugins.
- Viewing per-account run artifacts from the web UI, including Playwright traces, screenshots, failure details, and step logs.

## Important Safety Rules

- Never print, copy, or commit secrets from `.env`.
- Do not bypass CAPTCHA, MFA, or SSO. The login flow only supports native Zoom email/password login.
- Do not run live Zoom automation against real accounts unless the user explicitly asks for it.
- Prefer `DRY_RUN=true` and `HEADLESS=false` for first-pass diagnostics.
- Treat Zoom UI selectors as unstable. Use role, label, and visible-text locators where possible, and verify with a headed run when changing flows.
- Sub-account impersonation is cookie-backed. Keep the current pattern: log in once as the master admin, capture storage state, create a fresh browser context per sub account, impersonate inside that context, then close it.
- Preserve failure artifacts: screenshots, JSON failure details, and Playwright traces under `output/artifacts/`.
- Do not commit generated or experimental workflows under `src/workflows/recorded/` unless the user explicitly wants that workflow included.

## Common Commands

```bash
npm install
npm run playwright:install
npm test
npm run typecheck
npm run build
npm run build:ui
```

Run the CLI automation:

```bash
HEADLESS=false DRY_RUN=true SUB_ACCOUNT_IDS=sub_account_id npm start
```

Run the web UI:

```bash
UI_PORT=4174 npm run dev
```

Serve the built UI:

```bash
npm run build:ui
UI_DEV=false UI_PORT=4174 npm run serve:ui
```

## Repository Map

- `src/main.ts`: CLI entry point for batch automation.
- `src/server/`: Express API and UI server.
- `src/server/services/workflowRegistry.ts`: Workflow definitions shown in the UI.
- `src/server/services/jobRunner.ts`: Bridges UI jobs to automation flows.
- `src/server/services/artifacts.ts`: Indexes trace, screenshot, failure-detail, and log artifacts for the UI.
- `src/ui/`: React UI.
- `src/ui/components/`: UI panels and controls.
- `src/compiler/`: Recorded-workflow schema compiler, selector healing, and generated-flow helpers.
- `extension/`: Chrome workflow recorder with side panel, selector testing, preflight testing, and JSON export/sync.
- `src/recorderDebug/`: Recorder debug CLI and shared debug contracts.
- `src/server/services/recorderDebugStore.ts`: File-backed recorder session snapshots, command queue, results, and events.
- `src/automation/`: Shared runner, retry, progress, and flow types.
- `src/zoom/api.ts`: Zoom API client for sub-account retrieval.
- `src/zoom/auth.ts`: Zoom native login and master storage-state capture.
- `src/zoom/impersonation.ts`: Cookie-backed sub-account impersonation.
- `src/zoom/businessAddressFlow.ts`: Add-address workflow and address/status text helpers.
- `src/zoom/businessAddressStatusFlow.ts`: Read-only business-address status workflow.
- `src/addressProfiles.ts`: YAML address-profile loader.
- `addresses.yaml`: Country-specific address profiles and document requirements.
- `tests/`: Vitest tests.
- `reference/`: Historical/sample scripts. Use them only for context, not as code to copy blindly.

## Architecture Notes

The automation core is flow-oriented. A workflow should implement `AutomationFlow` from `src/automation/types.ts`:

```ts
export interface AutomationFlow {
  name: string;
  run(input: FlowInput): Promise<FlowResult>;
}
```

The `AutomationRunner` handles batching, retry, account delays, and progress updates. Keep Zoom-specific page logic inside `src/zoom/*` flows.

For UI-triggered jobs, add the workflow to `workflowRegistry.ts` and instantiate it in `jobRunner.ts`. Recorded workflows can also be imported through `/api/workflows/import`, compiled into `src/workflows/recorded/`, and then registered intentionally.

The recorded-workflow schema supports per-step timeout, retry count, retry delay, continue-on-failure, screenshot-on-failure, and simple condition guards such as skip-if-text-exists, click-if-element-visible, fill-if-empty, and skip-account-if-address-exists. Keep generated code aligned with `src/compiler/types.ts` and `extension/shared/types.ts`.

Compiled recorded workflows should use selector healing helpers from `src/compiler/selectorHealing.ts`. Prefer stable role/label/test-id selectors, and treat CSS-only selectors as warnings that need review.

## Business Address Profiles

Address data lives in `addresses.yaml`, selected with:

```bash
ADDRESS_PROFILE=australia_sydney
ADDRESS_PROFILES_PATH=addresses.yaml
```

Country and number-type combinations can change required fields. Keep country-specific details in YAML where possible, and keep secrets in `.env`.

## UI Guidelines

This is a standalone web app, not a Zoom Workplace embedded surface.

Use the existing PRISM-inspired UI patterns:

- Semantic PRISM token variables from `/prism/tokens.css`.
- Dense operational layouts.
- Tables, panels, compact controls, and clear status badges.
- No marketing hero pages or decorative backgrounds.

After meaningful UI changes, verify in the browser at `http://localhost:4174/` when the dev server is running.

For Chrome extension changes, run:

```bash
cd extension
npx tsc --noEmit
npm run build
```

The extension side panel currently includes recording pause/resume, manual step insertion, selector test/repair, browser preflight testing, per-step policy controls, conditional steps, detected parameters, and generated workflow quality reports.

## Recorder Debug Bridge

Prefer the recorder debug bridge before using visual browser or computer-control tools. It is much lower token and exposes structured recorder state from the Chrome extension through the local web server.

Use this path whenever you need to inspect or test a recorded Zoom workflow and the user has Chrome logged into Zoom with the recorder extension loaded:

1. Start the local web server:

```bash
UI_PORT=4174 npm run dev
```

2. Reload the unpacked extension from `extension/dist/`.
3. Record or import the workflow in Chrome.
4. Inspect the latest structured snapshot before reaching for screenshots or computer-use:

```bash
npm run recorder:latest
npm run recorder:actions
npm run recorder:workflow
```

The extension posts snapshots to `output/recorder-sessions/`. A snapshot includes raw actions, prepared/deduped actions, generated workflow JSON when available, quality scoring, page URL/title, and browser test events. Use these files and CLI output for most diagnosis.

Common CLI commands:

```bash
npm run recorder:latest
npm run recorder:workflow
npm run recorder:actions
npm run recorder:actions -- --raw
npm run recorder:sessions
npm run recorder:events
npm run recorder:test
npm run recorder:test -- --from step_id
npm run recorder:export -- --out output/debug/workflow.json
```

`npm run recorder:test` enqueues a browser-preflight command through `/api/recorder/debug/commands`. The extension polls the queue, runs the workflow against the active Chrome tab, then posts structured results and events back to the server. Use `npm run recorder:events` or `npm run recorder:latest` to inspect progress/results. Use `npm run recorder:test -- --from step_id` to replay from a selected step after manually resetting the Zoom page to the expected state.

The CLI uses `RECORDER_DEBUG_BASE_URL` when set, otherwise `http://127.0.0.1:4174`. The extension uses its configured `serverUrl` when set, otherwise the same default. If commands appear stuck, confirm the web server is running, the unpacked extension has been reloaded after the latest build, and Chrome is on a scriptable Zoom page.

Fallback to Chrome/browser/computer-control only when the debug bridge cannot answer the question, for example when you need to click through a brand-new flow, visually inspect layout, or recover from a modal/pop-up that blocks recording.

Do not put secrets in recorded steps or debug snapshots. Treat `output/recorder-sessions/` as local diagnostics and avoid committing it.

## Testing Expectations

Use tests for behavior changes. Prefer focused tests first, then run broader checks.

Typical completion checks:

```bash
npm test
npm run typecheck
npm run build
npm run build:ui
```

For narrow UI helper changes, at minimum run the relevant test file, `npm run typecheck`, and `npm run build:ui`.

Current caveat: if untracked generated workflows exist under `src/workflows/recorded/`, root `npm run typecheck` may fail on those generated files. Do not delete, rewrite, or commit them unless the user asks. Mention the caveat in the final response and run focused checks that avoid those files where possible.

## Workflow Output

The web UI uses a file-backed job store under `output/jobs/`. Per-account workflow output appears in the Run monitor account rows.

For `Check business address status`, completed rows show messages such as:

- `Address status: Pending`
- `Address status: Verified`
- `Address status: Rejected`
- `Address status: Unknown`
- `Address not found`

Expand an account row in the Run monitor to access artifacts:

- `Open trace`: opens trace zips through Playwright Trace Viewer.
- `Download trace`: downloads the trace zip.
- `View screenshots`: opens saved screenshots.
- `View failure details`: opens JSON page/error details.
- `View step logs`: opens JSONL logs where available.

## Known Constraints

- Zoom may show announcement popups. Use `dismissBlockingZoomPopups` for safe, known dismissible dialogs only.
- The status parser reads visible page text and matches the configured address plus number type. Be careful not to confuse `Toll` with `Toll-free`.
- Document upload requirements vary by country and number type.
- The CLI currently wires the add-address flow directly. UI workflows are selected through the server workflow registry.
- `src/workflows/recorded/` may contain untracked generated workflows from local recorder experiments. Treat them as user artifacts until instructed otherwise.
