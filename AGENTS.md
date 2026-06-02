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

## Important Safety Rules

- Never print, copy, or commit secrets from `.env`.
- Do not bypass CAPTCHA, MFA, or SSO. The login flow only supports native Zoom email/password login.
- Do not run live Zoom automation against real accounts unless the user explicitly asks for it.
- Prefer `DRY_RUN=true` and `HEADLESS=false` for first-pass diagnostics.
- Treat Zoom UI selectors as unstable. Use role, label, and visible-text locators where possible, and verify with a headed run when changing flows.
- Sub-account impersonation is cookie-backed. Keep the current pattern: log in once as the master admin, capture storage state, create a fresh browser context per sub account, impersonate inside that context, then close it.
- Preserve failure artifacts: screenshots, JSON failure details, and Playwright traces under `output/artifacts/`.

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
- `src/ui/`: React UI.
- `src/ui/components/`: UI panels and controls.
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

For UI-triggered jobs, add the workflow to `workflowRegistry.ts` and instantiate it in `jobRunner.ts`. The current UI supports one workflow per run so account-level output stays unambiguous.

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

## Workflow Output

The web UI stores job results in memory for this first release. Per-account workflow output appears in the Run monitor account rows.

For `Check business address status`, completed rows show messages such as:

- `Address status: Pending`
- `Address status: Verified`
- `Address status: Rejected`
- `Address status: Unknown`
- `Address not found`

If the UI server restarts, in-memory job results disappear.

## Known Constraints

- Zoom may show announcement popups. Use `dismissBlockingZoomPopups` for safe, known dismissible dialogs only.
- The status parser reads visible page text and matches the configured address plus number type. Be careful not to confuse `Toll` with `Toll-free`.
- Document upload requirements vary by country and number type.
- The CLI currently wires the add-address flow directly. UI workflows are selected through the server workflow registry.
- This workspace may not be a Git repository. Do not rely on `git diff` being available.
