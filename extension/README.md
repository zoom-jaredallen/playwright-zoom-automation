# Zoom Workflow Recorder — Chrome Extension

A Chrome extension that records user interactions in the Zoom admin portal and converts them into reusable, parameterized automation workflows.

## Installation (Development)

1. Install dependencies and build:
   ```bash
   cd extension
   npm install
   npm run build
   ```

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right)
   - Click **Load unpacked**
   - Select the `extension/dist/` folder

3. For development with auto-rebuild:
   ```bash
   npm run watch
   ```
   Then reload the extension in Chrome after changes.

## Usage

1. Navigate to any `zoom.us` admin page
2. Click the extension icon in the toolbar
3. Click **Open Side Panel** for the persistent recorder UI
4. Click **Start**
5. Perform the workflow you want to automate
6. Watch the live step list to confirm clicks, fills, selects, uploads, and navigation events are captured
7. Use the side panel to pause/resume capture, delete accidental steps, move steps up or down, rename step descriptions, or add manual workflow steps from the toolbar
8. Select a step and configure values, timeouts, and failure behavior in **Properties**
9. Hover between steps and use the **+** control to insert a new manual step at a specific position
10. Use **Test selector on page** to validate and highlight selector matches in the current page
11. Click **Stop**
12. Revert the Zoom configuration manually if needed, then click **Test** to preflight the workflow in the current browser tab
13. Review detected parameters and the generated quality report
14. Name the workflow and export:
   - **Download JSON** — save to disk, then compile with `npm run workflow:compile`
   - **Sync to Console** — POST directly to the automation server
   - **Copy JSON** — paste into the UI import dialog

## Compiling a Recorded Workflow

```bash
# From the project root:
npm run workflow:compile path/to/my-workflow.json

# With custom output directory:
npm run workflow:compile path/to/my-workflow.json --output src/workflows/recorded
```

This generates:
- `index.ts` — WorkflowPlugin export
- `flow.ts` — AutomationFlow implementation with error handling
- `test.ts` — Generated test file
- `schema.json` — Original recording for reference

## Architecture

```
popup/          → Quick launcher, compact record/review fallback
sidepanel/      → Persistent recording monitor, step editor, export UI
content/        → DOM event capture (runs on zoom.us pages)
background/     → Event aggregation, edit operations, workflow JSON generation
shared/         → Types, selector extraction, parameterization
```

## Side Panel Features

- Live captured-step feed while recording
- Pause and resume capture without ending the workflow
- Step toolbar for **Navigate**, **Validate**, **Screenshot**, and **Wait**
- Hover **+** controls for inserting a step between existing steps
- Properties inspector for configuring step values after insertion
- Per-step timeout, retry count, retry delay, continue-on-failure, and screenshot-on-failure controls
- Conditional step guards for skip-if-text-exists, click-if-element-visible, fill-if-empty, and skip-account-if-address-exists flows
- Selector test/repair tool with matched count, visible count, highlighted chosen element, and fallback candidate results
- Browser preflight test runner for replaying common workflow steps in the active tab before bulk runs
- Generated workflow quality report for selector stability, validation coverage, screenshot evidence, risky steps, hardcoded values, and unsupported preflight steps
- Draft recording state persisted in `chrome.storage.session` so service-worker restarts and paused navigation do not wipe the flow
- Delete, rename, and reorder recorded steps
- Selector confidence badges with CSS fallback override and selector notes
- Confirm or dismiss detected parameters
- Copy, download, or sync the edited workflow JSON

The browser preflight runner is intentionally lightweight. It replays common DOM-level steps such as navigation, click, fill, select, wait, and assertions inside the current browser tab. It does not replace the backend Playwright runner used for bulk execution.

## How Selectors Work

The recorder captures 5 selector strategies per element (ranked by stability):
1. ARIA role + accessible name
2. Label association
3. Visible text
4. data-testid
5. CSS selector (fallback)

The compiled workflow uses the most stable available selector with automatic fallback.

## How Parameterization Works

The recorder auto-detects account-specific values:
- Phone numbers → `{{phoneNumber}}`
- Email addresses → `{{contact.email}}`
- Street addresses → `{{address.line1}}`
- Country selections → `{{address.country}}`
- Customer names → `{{customerName}}`

At runtime, these resolve from the selected address profile in `addresses.yaml`.
