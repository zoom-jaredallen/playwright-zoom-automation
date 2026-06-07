import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAutomationServer } from "../src/server/app.js";

const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => error ? reject(error) : resolve());
  })));
});

describe("recorder debug routes", () => {
  it("stores snapshots and exposes the latest recorder session", async () => {
    const baseUrl = await startServer();
    const snapshot = makeSnapshot("route-session-1");

    const saveResponse = await postJson(`${baseUrl}/api/recorder/debug/snapshot`, snapshot);
    expect(saveResponse.status).toBe(201);

    const latest = await getJson(`${baseUrl}/api/recorder/debug/latest`);
    expect(latest.status).toBe(200);
    expect(latest.body.snapshot).toMatchObject({
      sessionId: "route-session-1",
      status: { actionCount: 1 }
    });
  });

  it("leases debug commands and records command results", async () => {
    const baseUrl = await startServer();

    const created = await postJson(`${baseUrl}/api/recorder/debug/commands`, {
      type: "RUN_TEST_WORKFLOW_FROM",
      payload: { actionId: "step-1" }
    });
    expect(created.status).toBe(201);
    expect(created.body.command).toMatchObject({ type: "RUN_TEST_WORKFLOW_FROM", status: "pending" });

    const leased = await getJson(`${baseUrl}/api/recorder/debug/commands/next`);
    expect(leased.status).toBe(200);
    expect(leased.body.command).toMatchObject({ id: created.body.command.id, status: "leased" });

    const completed = await postJson(`${baseUrl}/api/recorder/debug/commands/${created.body.command.id}/result`, {
      ok: true,
      message: "test finished",
      events: [{ timestamp: 1, level: "success", message: "done" }]
    });
    expect(completed.status).toBe(200);
    expect(completed.body.command).toMatchObject({ id: created.body.command.id, status: "completed" });

    const command = await getJson(`${baseUrl}/api/recorder/debug/commands/${created.body.command.id}`);
    expect(command.body.command.result).toMatchObject({ ok: true, message: "test finished" });
  });

  it("accepts training commands and exposes latest training report", async () => {
    const baseUrl = await startServer();
    const created = await postJson(`${baseUrl}/api/recorder/debug/commands`, {
      type: "RUN_TRAINING_WORKFLOW",
      payload: { iterations: 3, fromActionId: "step-1" }
    });
    expect(created.status).toBe(201);
    expect(created.body.command).toMatchObject({ type: "RUN_TRAINING_WORKFLOW" });

    await postJson(`${baseUrl}/api/recorder/debug/commands/${created.body.command.id}/result`, {
      ok: true,
      trainingReport: {
        sessionId: "route-session-1",
        workflowName: "Workflow",
        startedAt: "2026-06-07T00:00:00.000Z",
        finishedAt: "2026-06-07T00:00:10.000Z",
        summary: { iterations: 3, passed: 3, failed: 0, completionRate: 100, score: 95 },
        iterations: [],
        stepHealth: [],
        recommendations: []
      }
    });

    const latest = await getJson(`${baseUrl}/api/recorder/debug/training/latest`);
    expect(latest.status).toBe(200);
    expect(latest.body.report.summary.score).toBe(95);
  });
});

async function startServer(): Promise<string> {
  process.env.RECORDER_DEBUG_DIR = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-routes-"));
  process.env.ZOOM_ADMIN_EMAIL = "admin@example.com";
  process.env.ZOOM_ADMIN_PASSWORD = "password";
  process.env.ZOOM_API_ACCESS_TOKEN = "token";
  process.env.ADDRESS_PROFILE = "australia_sydney";
  process.env.ADDRESS_PROFILES_PATH = "addresses.yaml";
  process.env.DRY_RUN = "true";

  const app = createAutomationServer({ envPath: path.join(os.tmpdir(), "missing-recorder-debug.env") });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const created = app.listen(0, "127.0.0.1", () => resolve(created));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function makeSnapshot(sessionId: string) {
  return {
    sessionId,
    timestamp: "2026-06-07T00:00:00.000Z",
    source: "extension",
    status: { recording: false, paused: false, actionCount: 1 },
    rawActions: [{ id: "a1", type: "navigate", timestamp: 1, selectors: {} }],
    preparedActions: [{ id: "a1", type: "navigate", timestamp: 1, selectors: {} }],
    testState: { running: false, events: [] },
    page: { url: "https://zoom.us/cpw/page/phoneNumbers#/business-address", title: "Business Address" }
  };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(url: string) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}
