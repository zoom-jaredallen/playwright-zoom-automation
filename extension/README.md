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
3. Click **Start Recording**
4. Perform the workflow you want to automate
5. Click **Stop Recording**
6. Review detected parameters (confirm or dismiss)
7. Name the workflow and export:
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
popup/          → Record/Stop UI, parameter review, export
content/        → DOM event capture (runs on zoom.us pages)
background/     → Event aggregation, workflow JSON generation
shared/         → Types, selector extraction, parameterization
```

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
