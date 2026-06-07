# Recorder Training Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome bridge and CLI training harness that lets Codex run repeatable browser preflight passes, inspect stability, and improve recorded workflow quality with structured reports instead of visual browser control.

**Architecture:** The existing extension debug bridge remains the active Chrome executor. The server persists commands, snapshots, reports, and event history. The CLI gains analysis and orchestration commands that enqueue extension work, wait for completion, summarize results, audit workflow quality, and export a debug bundle.

**Tech Stack:** TypeScript, Express, Chrome extension service worker, file-backed JSON/JSONL persistence, `tsx`, Vitest, existing `@zoom-automation/workflow-core` types.

---

## Top 10 Enhancements

1. **Training Run Command:** Add `RUN_TRAINING_WORKFLOW` so Codex can ask the extension to replay the current workflow multiple times.
2. **Per-Iteration Reports:** Capture pass/fail status, duration, failed step id, and events for each training iteration.
3. **Step Health Metrics:** Aggregate pass/fail counts, failure rate, last error, and average duration per step.
4. **Workflow Training Score:** Produce a 0-100 training score based on completion rate, failed steps, selector quality, assertions, and evidence.
5. **Recommendations Engine:** Generate actionable workflow review recommendations such as “add assertion after Save”, “repair CSS-only selector”, or “parameterize hardcoded field”.
6. **Persisted Training Reports:** Store `latest-training-report.json` and per-session `training-report.json` under `output/recorder-sessions/`.
7. **CLI `train` Command:** Add `npm run recorder:train -- --iterations 3 --from step_id --delay-ms 1000` to enqueue training runs.
8. **CLI `wait` Command:** Add a polling command so Codex can wait for queued bridge commands without manually checking JSON repeatedly.
9. **CLI `audit` / `report` Commands:** Add local quality audit and latest training report summaries for fast review.
10. **CLI `bundle` and `diff` Commands:** Export latest snapshot artifacts into one folder and show raw vs prepared step differences, useful for diagnosing duplicate or filtered recorder events.

## Files

- Modify `src/recorderDebug/types.ts`: Add training command/report types.
- Create `src/recorderDebug/trainingReport.ts`: Pure report, audit, recommendations, diff, and summary helpers.
- Modify `src/server/services/recorderDebugStore.ts`: Persist latest and per-session training reports.
- Modify `src/server/app.ts`: Allow `RUN_TRAINING_WORKFLOW` and expose `/api/recorder/debug/training/latest`.
- Modify `src/recorderDebug/cli.ts`: Add `train`, `wait`, `report`, `audit`, `diff`, and `bundle` commands.
- Modify `extension/shared/debugBridge.ts`: Mirror training command/result wire types.
- Modify `extension/background/service-worker.ts`: Execute training iterations in active Chrome.
- Modify `package.json`: Add `recorder:train`, `recorder:report`, `recorder:audit`, `recorder:diff`, `recorder:bundle`, and `recorder:wait` scripts.
- Update `AGENTS.md` and `CLAUDE.md`: Document training runs and safety caveats.
- Tests: `tests/recorderTrainingReport.test.ts`, plus updates to `tests/recorderDebugCli.test.ts`, `tests/recorderDebugStore.test.ts`, and `tests/recorderDebugRoutes.test.ts`.

## Phase 1: Types, Report Engine, and Store Persistence

- [ ] Write failing tests for training report scoring, step health, recommendations, and report persistence.
- [ ] Add shared training report types to `src/recorderDebug/types.ts`.
- [ ] Implement `src/recorderDebug/trainingReport.ts` with pure helpers.
- [ ] Persist latest/per-session training reports in `recorderDebugStore` when command results include `trainingReport`.
- [ ] Run `npx vitest run tests/recorderTrainingReport.test.ts tests/recorderDebugStore.test.ts`.

## Phase 2: Server API and CLI Commands

- [ ] Write failing tests for `RUN_TRAINING_WORKFLOW` route acceptance and CLI payload/formatting helpers.
- [ ] Add `RUN_TRAINING_WORKFLOW` to server command validation.
- [ ] Add `GET /api/recorder/debug/training/latest`.
- [ ] Add CLI commands: `train`, `wait`, `report`, `audit`, `diff`, `bundle`.
- [ ] Add npm scripts for the new commands.
- [ ] Run `npx vitest run tests/recorderDebugCli.test.ts tests/recorderDebugRoutes.test.ts`.

## Phase 3: Extension Training Executor

- [ ] Mirror training wire types in `extension/shared/debugBridge.ts`.
- [ ] Add `RUN_TRAINING_WORKFLOW` handling in `extension/background/service-worker.ts`.
- [ ] Run each iteration through existing preflight machinery, collect events, durations, failed steps, and final report.
- [ ] Keep network errors swallowed and do not break normal recording when the server is unavailable.
- [ ] Run `npx tsc -p extension/tsconfig.json --noEmit --pretty false` and `npm run build -w zoom-workflow-recorder`.

## Phase 4: Docs, Full Verification, and Commit

- [ ] Document training harness command order and safety caveats in `AGENTS.md` and `CLAUDE.md`.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:ui`, and extension build.
- [ ] Commit all changes to `main` with `feat: add recorder training harness`.
