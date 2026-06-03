# Zoom Business Address Automation

TypeScript + Playwright CLI app for adding a preconfigured business address and verification documents across Zoom sub accounts.

## Design

The app is split into a reusable automation core and Zoom-specific flows:

- `src/automation/*` contains retry, progress, runner, and shared flow interfaces.
- `src/zoom/api.ts` retrieves sub accounts from `GET /v2/accounts`.
- `src/zoom/auth.ts` logs into the Zoom admin web portal and captures master storage state.
- `src/zoom/impersonation.ts` enters a sub-account context through Zoom's cookie-backed impersonation URL.
- `src/zoom/businessAddressFlow.ts` implements the current Business Address & Documents automation.
- `src/main.ts` wires config, API, login, progress, and the selected flow together.

Sub-account impersonation is isolated by browser context. The app logs in once as the master admin, captures clean master storage state, then creates a fresh browser context for each sub account. Impersonation mutates only that context's cookies, and the context is closed after the account finishes.

## Setup

```bash
npm install
npm run playwright:install
cp .env.example .env
cp addresses.yaml.example addresses.yaml
```

Edit `.env` with real credentials and select an address profile:

```bash
ADDRESS_PROFILE=australia_sydney
ADDRESS_PROFILES_PATH=addresses.yaml
```

Address profiles live in `addresses.yaml`. This keeps country-specific address, contact, and document rules out of `.env` while leaving `.env` for secrets and run controls. The legacy `BUSINESS_ADDRESS_*` fields still work when `ADDRESS_PROFILE` is blank, and can override profile values when needed.

For Australia Toll addresses, Zoom expects:

- profile `address.line1`: street address, for example `9 Castlereagh St`
- profile `address.line2`: suite/floor/unit, for example `Level 1`
- profile `numberType`: `Toll`, `Toll-free`, or `Mobile`
- profile `customerName`: the customer/entity name shown on the address record

Some country/number-type combinations render additional required fields. For example, Singapore Toll currently requires contact name, contact number, contact email, and a Proof of Business upload before Save. Configure:

- profile `contact.name`
- profile `contact.number`
- profile `contact.email`
- profile `documents.businessVerificationPath`

## First Safe Run

Start with a headed dry run against one known test sub account:

```bash
HEADLESS=false DRY_RUN=true SUB_ACCOUNT_IDS=sub_account_id npm start
```

Then run the real flow for that one account:

```bash
HEADLESS=false DRY_RUN=false SUB_ACCOUNT_IDS=sub_account_id npm start
```

After the selectors are verified in the live Zoom UI, remove `SUB_ACCOUNT_IDS` or use `SUB_ACCOUNT_LIMIT` to ramp up gradually.

## Targeting Sub Accounts

You can target an explicit comma-separated set of account IDs:

```bash
SUB_ACCOUNT_IDS=account_id_1,account_id_2 npm start
```

You can also target an inclusive owner range. The range endpoints must share the same text before and after the number, so this example runs only owners `s301` through `s350`:

```bash
SUB_ACCOUNT_OWNER_FROM=michael.chen@lab494-s301.zoomdemos.com \
SUB_ACCOUNT_OWNER_TO=michael.chen@lab494-s350.zoomdemos.com \
npm start
```

Owner range filtering checks `ownerEmail`, then `ownerName`, then the account name returned by Zoom. It composes with `SUB_ACCOUNT_IDS` and `SUB_ACCOUNT_LIMIT`.

## Resume Behavior

Progress is written to `output/progress.json` by default. Completed accounts are skipped on later runs. Failed accounts remain retryable by rerunning the app after the underlying issue is fixed.

Each sub-account browser flow can retry retryable failures such as page timeouts, transient navigation failures, and temporary Zoom errors. Configure this with:

- `FLOW_RETRY_ATTEMPTS`: defaults to `2`
- `FLOW_RETRY_BASE_DELAY_MS`: defaults to `5000`
- `ACCOUNT_DELAY_MS`: optional pause between accounts, defaults to `0`

Before a real run, document paths are checked for existence, supported extension, and Zoom's 10MB upload limit. Dry runs skip document preflight so you can safely test form detection with placeholder paths.

Failure screenshots, JSON page snapshots, and Playwright traces are written under `output/artifacts/`.
In the web UI, expand an account row in the run monitor to open traces in Playwright Trace Viewer, download trace zips, view screenshots, inspect failure details, and open step logs.

## Adding Future Automations

Create a new class that implements `AutomationFlow`:

```ts
import type { AutomationFlow, FlowInput, FlowResult } from "./automation/types.js";

export class SomeOtherZoomFlow implements AutomationFlow {
  readonly name = "some-other-zoom-flow";

  async run(input: FlowInput): Promise<FlowResult> {
    // Use input.account and shared Zoom session helpers.
    return { status: "completed" };
  }
}
```

Then wire that flow into `src/main.ts`. The account retrieval, login, progress, retry, and batch runner do not need to change.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The Business Address page selectors are intentionally role/label based, but Zoom may change labels or form structure. Use the first safe run above to capture traces and adjust `src/zoom/businessAddressFlow.ts` for the live tenant UI.
