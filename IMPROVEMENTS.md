# Top 10 Most Impactful Improvements

After reviewing the full codebase — automation core, Zoom flows, server/API layer, React UI, tests, and configuration — here are the 10 highest-impact improvements ranked by a combination of reliability, scalability, developer experience, and operational safety.

---

## 1. Persistent Job Store (Replace In-Memory with SQLite/File-Based)

**Impact: High — Operational reliability**

The `inMemoryJobStore.ts` loses all job history when the server restarts. For an automation that runs across 50+ accounts and takes minutes to complete, losing visibility into past runs is a real operational gap.

**Recommendation:** Replace the in-memory `Map` with a lightweight SQLite store (via `better-sqlite3`) or a JSON-file-backed store similar to `ProgressStore`. This gives you:
- Job history survives restarts.
- Ability to correlate CLI runs with UI-triggered runs.
- Foundation for future features like "retry all failed accounts from job X."

**Files affected:** `src/server/services/inMemoryJobStore.ts`, `src/server/app.ts`

---

## 2. Parallel Account Processing with Configurable Concurrency

**Impact: High — Speed**

The `AutomationRunner` processes accounts sequentially. With 50 accounts and ~30s per account (navigation + form fill + verification), a full run takes ~25 minutes. Playwright supports multiple browser contexts concurrently.

**Recommendation:** Add a `concurrency` option (default 1 for safety, configurable to 3–5) using a simple semaphore/pool pattern. Each account already gets its own `BrowserContext`, so isolation is already handled.

```ts
// Conceptual addition to AutomationRunner
async run(accounts: SubAccount[]): Promise<RunSummary> {
  const pool = new ConcurrencyPool(this.options.concurrency ?? 1);
  await Promise.all(accounts.map(account => pool.run(() => this.processAccount(account))));
}
```

**Files affected:** `src/automation/runner.ts`, `src/config.ts` (add `CONCURRENCY` env var)

---

## 3. Structured Event Logging with Log Levels and File Output

**Impact: High — Debuggability**

The current `consoleLogger` writes JSON lines to stdout/stderr. For production automation runs, you need:
- Log file output alongside console (for post-mortem analysis).
- Configurable log level (debug/info/warn/error).
- Correlation IDs per account so you can grep a single account's journey.

**Recommendation:** Extend the `Logger` interface with a `child(meta)` method that returns a scoped logger. Add a file transport that writes to `output/logs/{timestamp}.jsonl`. Add `LOG_LEVEL` env var.

**Files affected:** `src/logger.ts`, `src/main.ts`, `src/server/services/jobRunner.ts`

---

## 4. WebSocket/SSE Real-Time Job Updates (Replace Polling)

**Impact: Medium-High — UX**

The React UI polls `GET /api/jobs/:id` every 1.5 seconds. This creates unnecessary load and introduces latency in status updates. With 50 accounts, the UI can feel sluggish.

**Recommendation:** Add Server-Sent Events (SSE) on `GET /api/jobs/:id/stream`. The job runner emits events as accounts transition states. The UI subscribes once and gets instant updates. SSE is simpler than WebSocket for this one-directional flow and works with Express.

**Files affected:** `src/server/app.ts`, `src/server/services/jobRunner.ts`, `src/ui/api.ts`, `src/ui/App.tsx`

---

## 5. Token Refresh and Session Expiry Handling

**Impact: High — Reliability for long runs**

The OAuth access token is fetched once at startup. Zoom Server-to-Server tokens expire after 1 hour. For runs longer than 60 minutes (50 accounts × sequential × retries), the API token will expire mid-run, causing all subsequent `listSubAccounts` or future API calls to fail silently.

Similarly, the master browser session (`StorageState`) could expire during very long runs, causing impersonation failures that look like transient errors.

**Recommendation:**
- Wrap the `ZoomApiClient` with a token-refresh layer that re-fetches when the token is within 5 minutes of expiry.
- Add a `refreshMasterSession()` method that re-logs in if the master session is older than N minutes, and call it periodically between accounts.

**Files affected:** `src/zoom/oauth.ts`, `src/zoom/api.ts`, `src/zoom/auth.ts`, `src/main.ts`

---

## 6. CLI Progress Bar and Summary Report

**Impact: Medium — Developer/operator experience**

The CLI (`npm start`) outputs JSON log lines. For a 50-account run, it's hard to see at a glance how far along you are or what failed. There's no final summary report saved to disk.

**Recommendation:**
- Add a TTY-aware progress indicator (e.g., using `cli-progress` or a simple `[12/50] Processing account s312...` line).
- At the end of a run, write a `output/run-summary-{timestamp}.json` with per-account results, timing, and error messages.
- Optionally generate a Markdown table for quick human review.

**Files affected:** `src/main.ts`, new file `src/reporting.ts`

---

## 7. Workflow Plugin Architecture (Dynamic Flow Loading)

**Impact: Medium-High — Extensibility**

Currently, adding a new workflow requires editing 3 files: the flow class, `workflowRegistry.ts`, and `jobRunner.ts`. The `AGENTS.md` even documents this coupling. As you add more workflows (10DLC, account settings, phone number provisioning), this becomes tedious and error-prone.

**Recommendation:** Use a convention-based plugin pattern:
- Each workflow lives in `src/workflows/{id}/index.ts` and exports a `WorkflowDefinition` + `AutomationFlow` factory.
- A loader scans the directory and auto-registers workflows.
- The registry and job runner become generic — no per-workflow switch statements.

**Files affected:** `src/server/services/workflowRegistry.ts`, `src/server/services/jobRunner.ts`, new `src/workflows/` directory

---

## 8. End-to-End Test with Mock Zoom Server

**Impact: Medium-High — Confidence in changes**

The test suite has excellent unit coverage for the runner, retry, filters, and config. But there's no integration test that exercises the full flow (login → impersonate → fill form → verify) against a mock. This means any Zoom UI change or selector regression is only caught in production.

**Recommendation:** Create a lightweight Express mock that serves fake Zoom login, impersonation, and business-address pages. Write a Playwright test that runs the `BusinessAddressFlow` against this mock. This catches:
- Selector regressions when refactoring.
- Logic errors in the popup dismissal, form fill, and verification steps.
- Impersonation cookie validation issues.

**Files affected:** New `tests/e2e/` directory, new `tests/e2e/mockZoomServer.ts`, new `tests/e2e/businessAddressFlow.e2e.test.ts`

---

## 9. Graceful Shutdown and Run Cancellation

**Impact: Medium — Operational safety**

There's no way to cancel a running job from the UI, and if the process is killed mid-run, accounts in "running" state are left in limbo in `progress.json`. The CLI has no signal handler.

**Recommendation:**
- Add `SIGINT`/`SIGTERM` handlers in `main.ts` that set a cancellation flag. The runner checks this flag between accounts and exits gracefully.
- Add a `POST /api/jobs/:id/cancel` endpoint that sets a cancellation token. The job runner checks it between accounts.
- On startup, the `ProgressStore` should reset any accounts stuck in "running" back to retryable.

**Files affected:** `src/main.ts`, `src/automation/runner.ts`, `src/server/app.ts`, `src/server/services/jobRunner.ts`, `src/automation/progressStore.ts`

---

## 10. Configuration Validation with Zod and Early Failure

**Impact: Medium — Developer experience and safety**

The `config.ts` file has grown to ~180 lines of manual parsing, validation, and fallback logic. It's easy to introduce bugs (e.g., a typo in an env var name silently falls through to `undefined`). The address profile resolution with env-var overrides is particularly complex.

**Recommendation:** Replace the manual parsing with a Zod schema:
- Define the full config shape with Zod (including transforms for booleans, integers, CSV lists).
- Validate once at startup and get clear, actionable error messages.
- Type inference from the schema eliminates the separate `AppConfig` interface.
- Profile merging becomes a simple `z.object().merge()` or `.default()` chain.

**Files affected:** `src/config.ts`, add `zod` to dependencies

---

## Priority Matrix

| # | Improvement | Effort | Impact | Priority |
|---|-------------|--------|--------|----------|
| 1 | Persistent Job Store | Low | High | 🔴 Do first |
| 2 | Parallel Processing | Medium | High | 🔴 Do first |
| 5 | Token Refresh | Low | High | 🔴 Do first |
| 9 | Graceful Shutdown | Medium | Medium | 🟡 Do next |
| 3 | Structured Logging | Low | High | 🟡 Do next |
| 4 | SSE Real-Time Updates | Medium | Medium-High | 🟡 Do next |
| 7 | Workflow Plugins | Medium | Medium-High | 🟡 Do next |
| 8 | E2E Mock Tests | High | Medium-High | 🔵 Plan for |
| 10 | Zod Config | Medium | Medium | 🔵 Plan for |
| 6 | CLI Progress/Report | Low | Medium | 🔵 Plan for |

---

## Quick Wins (< 1 hour each)

If you want to start with low-effort, high-value changes right now:

1. **Token refresh** — wrap `resolveZoomApiAccessToken` with a cache + TTL check (~30 min).
2. **Reset stale "running" accounts on startup** — 10 lines in `ProgressStore.load()`.
3. **Add `CONCURRENCY=1` env var** — even without implementing parallelism, having the config ready signals intent.
4. **Write run summary JSON** — append 20 lines to `main.ts` after the runner finishes.

---

Want me to implement any of these? I can start with whichever one (or combination) you'd like to tackle first.
