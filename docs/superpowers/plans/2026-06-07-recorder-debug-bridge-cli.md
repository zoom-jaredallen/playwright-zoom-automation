# Recorder Debug Bridge and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a low-token recorder debug bridge so Codex can inspect, export, and test Zoom workflow recordings through structured files and CLI commands instead of visual browser control.

**Architecture:** The Chrome extension remains responsible for observing and testing the live Zoom tab, but it syncs structured snapshots and command results to the existing local Express server. The server owns file-backed recorder session persistence under `output/recorder-sessions/` and exposes narrow `/api/recorder/debug/*` endpoints. A root TypeScript CLI calls those endpoints and prints concise JSON/text for Codex and human operators.

**Tech Stack:** TypeScript, Chrome extension service worker/content scripts, Express, Node fs/path APIs, `tsx`, Vitest, existing `@zoom-automation/workflow-core` schema and quality report types.

---

## File Structure

- Create `src/recorderDebug/types.ts`: Shared server/CLI debug bridge contracts without Chrome globals.
- Create `src/server/services/recorderDebugStore.ts`: File-backed session, command, result, and JSONL event persistence.
- Modify `src/server/app.ts`: Mount debug endpoints and static session artifact access.
- Create `src/recorderDebug/cli.ts`: Local CLI for state, workflow, actions, sessions, export, enqueueing tests, command status, and event tailing.
- Create `extension/shared/debugBridge.ts`: Extension-side HTTP client for posting snapshots, events, and command results to the local server.
- Modify `extension/shared/types.ts`: Add extension debug message types if needed for explicit snapshot triggers.
- Modify `extension/background/service-worker.ts`: Publish snapshots on recorder/test state changes, poll commands, execute supported debug commands, and post results.
- Modify `package.json`: Add `recorder:*` scripts.
- Create tests in `tests/recorderDebugStore.test.ts`, `tests/recorderDebugRoutes.test.ts`, and `tests/recorderDebugCli.test.ts`.
- Update `AGENTS.md` and `CLAUDE.md`: Document debug bridge commands and operating expectations.

## Task 1: Debug Contracts and File Store

**Files:**
- Create: `src/recorderDebug/types.ts`
- Create: `src/server/services/recorderDebugStore.ts`
- Test: `tests/recorderDebugStore.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRecorderDebugStore } from "../src/server/services/recorderDebugStore.js";

it("stores a snapshot as latest and appends structured events", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-"));
  const store = createRecorderDebugStore({ directory: dir });
  const snapshot = store.saveSnapshot({
    sessionId: "session-1",
    timestamp: "2026-06-07T00:00:00.000Z",
    source: "extension",
    status: { recording: false, paused: false, actionCount: 1 },
    rawActions: [{ id: "a1", type: "navigate", timestamp: 1, selectors: {} }],
    preparedActions: [{ id: "a1", type: "navigate", timestamp: 1, selectors: {} }],
    workflow: undefined,
    quality: undefined,
    testState: { running: false, events: [] },
    page: { url: "https://zoom.us/cpw/page/phoneNumbers#/business-address", title: "Business Address" }
  });

  expect(snapshot.sessionId).toBe("session-1");
  expect(store.latest()?.sessionId).toBe("session-1");
  expect(store.listSessions()).toEqual([expect.objectContaining({ sessionId: "session-1", actionCount: 1 })]);
  const events = readFileSync(path.join(dir, "session-1", "events.jsonl"), "utf8").trim().split("\n");
  expect(JSON.parse(events[0])).toMatchObject({ event: "snapshot_saved", sessionId: "session-1" });
});

it("creates pending commands and records command results", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-"));
  const store = createRecorderDebugStore({ directory: dir });
  const command = store.createCommand({ type: "RUN_TEST_WORKFLOW", payload: {} });

  expect(store.nextPendingCommand()?.id).toBe(command.id);
  store.markCommandResult(command.id, { ok: true, events: [{ timestamp: 1, level: "success", message: "done" }] });
  expect(store.getCommand(command.id)?.status).toBe("completed");
  expect(store.nextPendingCommand()).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `npx vitest run tests/recorderDebugStore.test.ts`
Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement contracts and store**

Implement typed interfaces for `RecorderDebugSnapshot`, `RecorderDebugCommand`, `RecorderDebugCommandResult`, and a store that writes:

```text
output/recorder-sessions/latest.json
output/recorder-sessions/<sessionId>/snapshot.json
output/recorder-sessions/<sessionId>/raw-actions.json
output/recorder-sessions/<sessionId>/prepared-actions.json
output/recorder-sessions/<sessionId>/workflow.json
output/recorder-sessions/<sessionId>/events.jsonl
output/recorder-sessions/commands/<commandId>.json
```

- [ ] **Step 4: Run green check**

Run: `npx vitest run tests/recorderDebugStore.test.ts`
Expected: PASS.

## Task 2: Server Debug API

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/recorderDebugRoutes.test.ts`

- [ ] **Step 1: Write failing route tests**

Use `createAutomationServer({ envPath })` and `fetch` against an ephemeral listener to verify:

- `POST /api/recorder/debug/snapshot` saves a snapshot.
- `GET /api/recorder/debug/latest` returns it.
- `POST /api/recorder/debug/commands` enqueues a command.
- `GET /api/recorder/debug/commands/next` leases a pending command.
- `POST /api/recorder/debug/commands/:id/result` completes it.

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/recorderDebugRoutes.test.ts`
Expected: FAIL with 404 responses.

- [ ] **Step 3: Add endpoints**

Mount endpoints under `/api/recorder/debug`. Validate minimal required fields and return 400 for malformed bodies. Keep endpoint logic thin by delegating to `recorderDebugStore`.

- [ ] **Step 4: Run green check**

Run: `npx vitest run tests/recorderDebugRoutes.test.ts`
Expected: PASS.

## Task 3: CLI Commands

**Files:**
- Create: `src/recorderDebug/cli.ts`
- Modify: `package.json`
- Test: `tests/recorderDebugCli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Test pure command formatting functions where possible:

- `formatSummary(snapshot)` prints session id, URL, action counts, quality score, and test state.
- `buildCommandPayload("test", ["--from", "step-1"])` creates `{ type: "RUN_TEST_WORKFLOW_FROM", payload: { actionId: "step-1" } }`.

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/recorderDebugCli.test.ts`
Expected: FAIL because CLI helpers do not exist.

- [ ] **Step 3: Implement CLI**

Commands:

```bash
npm run recorder:latest
npm run recorder:workflow
npm run recorder:actions
npm run recorder:sessions
npm run recorder:export -- --out output/debug/workflow.json
npm run recorder:test
npm run recorder:test -- --from <actionId>
npm run recorder:command -- <commandId>
npm run recorder:events
```

Support `RECORDER_DEBUG_BASE_URL`, default `http://127.0.0.1:4174`.

- [ ] **Step 4: Run green check**

Run: `npx vitest run tests/recorderDebugCli.test.ts`
Expected: PASS.

## Task 4: Extension Debug Sync and Command Polling

**Files:**
- Create: `extension/shared/debugBridge.ts`
- Modify: `extension/background/service-worker.ts`
- Test: focused extension typecheck and existing recorder tests.

- [ ] **Step 1: Write failing/compile-facing tests where practical**

Add small tests for debug URL normalization and snapshot command mapping if helpers are pure and Chrome-free.

- [ ] **Step 2: Implement extension bridge**

- Default URL: `http://127.0.0.1:4174`.
- Respect existing `serverUrl` from extension local storage when present.
- Post snapshots after `persistAndBroadcast`, after `stopRecording`, and after test state changes.
- Poll `/api/recorder/debug/commands/next` every 2 seconds while extension is enabled.
- Execute only safe commands: `BUILD_WORKFLOW`, `RUN_TEST_WORKFLOW`, `RUN_TEST_WORKFLOW_FROM`, `GET_ACTIONS`, `GET_TEST_WORKFLOW_STATE`, `CLEAR_ACTIONS`.
- Post command result to `/api/recorder/debug/commands/:id/result`.
- Swallow network errors so the recorder works when the server is not running.

- [ ] **Step 3: Verify extension build**

Run: `npx tsc -p extension/tsconfig.json --noEmit`
Expected: PASS.

## Task 5: Documentation and Full Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document usage**

Add debug bridge notes, commands, and caveats: server must be running, extension must be reloaded, no secrets in snapshots, and CLI is for recorder diagnostics rather than live bulk automation.

- [ ] **Step 2: Run full checks**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run build:ui
npm run build -w zoom-workflow-recorder
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

Commit with message:

```bash
git add package.json src/recorderDebug src/server/services/recorderDebugStore.ts src/server/app.ts extension/shared/debugBridge.ts extension/background/service-worker.ts tests/recorderDebug*.test.ts AGENTS.md CLAUDE.md docs/superpowers/plans/2026-06-07-recorder-debug-bridge-cli.md
git commit -m "feat: add recorder debug bridge and cli"
```
