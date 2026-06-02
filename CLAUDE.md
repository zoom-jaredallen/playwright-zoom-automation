# CLAUDE.md

Claude and other coding assistants should follow `AGENTS.md` as the canonical project guide.

## Quick Context

This repo is a TypeScript + Playwright Zoom automation app with a standalone React/Express UI. It automates Zoom master-account tasks across sub accounts using:

- Zoom API for sub-account discovery.
- Native Zoom web login for master-admin browser state.
- Cookie-backed web impersonation for each sub account.
- A fresh Playwright browser context per account.

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
```

For UI-only edits, also inspect the app at:

```bash
UI_PORT=4174 npm run dev
```

## Do Not Do These

- Do not expose `.env` values.
- Do not bypass CAPTCHA, MFA, or SSO.
- Do not run live Zoom automation unless the user explicitly asks.
- Do not copy from `reference/` blindly. It is historical context only.
- Do not change the cookie-backed impersonation model unless the user asks for a new authentication strategy.

## Implementation Notes

- Add new automations as `AutomationFlow` implementations.
- Register UI workflows in `src/server/services/workflowRegistry.ts`.
- Instantiate runnable workflows in `src/server/services/jobRunner.ts`.
- Keep country-specific address and document requirements in `addresses.yaml` when possible.
- Keep UI changes consistent with the existing PRISM-inspired standalone app styling.
