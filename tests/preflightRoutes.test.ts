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

describe("preflight routes", () => {
  it("simulates selected accounts using an inline recorded workflow", async () => {
    const baseUrl = await startServer();
    const response = await postJson(`${baseUrl}/api/preflight/simulate`, {
      accounts: [
        { id: "a1", ownerEmail: "a1@example.com", name: "A1" },
        { id: "a2", ownerEmail: "a2@example.com", name: "A2" }
      ],
      workflows: [makeWorkflow()],
      accountEvidence: {
        a1: { visibleText: "Assigned +61 2 7000 0001" },
        a2: { visibleText: "+61 2 7000 0001 +61 2 7000 0002 +61 2 7000 0003 +61 2 7000 0004" }
      }
    });

    expect(response.status).toBe(200);
    expect(response.body.preflight.summary).toEqual({ willRun: 1, willSkip: 1, willFail: 0, needsReview: 0 });
  });
});

async function startServer(): Promise<string> {
  process.env.RECORDER_DEBUG_DIR = mkdtempSync(path.join(os.tmpdir(), "preflight-routes-"));
  process.env.ZOOM_ADMIN_EMAIL = "admin@example.com";
  process.env.ZOOM_ADMIN_PASSWORD = "password";
  process.env.ZOOM_API_ACCESS_TOKEN = "token";
  process.env.ADDRESS_PROFILE = "australia_sydney";
  process.env.ADDRESS_PROFILES_PATH = "addresses.yaml";
  process.env.DRY_RUN = "true";

  const app = createAutomationServer({ envPath: path.join(os.tmpdir(), "missing-preflight.env") });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const created = app.listen(0, "127.0.0.1", () => resolve(created));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function makeWorkflow() {
  return {
    version: 1,
    meta: {
      name: "Add Sydney numbers",
      description: "Fixture",
      recordedAt: "2026-06-08T00:00:00.000Z",
      recordedOnUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
      durationMs: 1000,
      category: "phone"
    },
    parameters: [],
    actions: [
      {
        id: "open",
        timestamp: 1,
        type: "click",
        selectors: { role: { role: "button", name: "Add Number" } },
        condition: {
          type: "entityStateGuard",
          operation: "assign",
          entityKind: "phoneNumber",
          match: { allText: ["Assigned +61 2 7000 0001"] },
          whenMatched: "skipAccount"
        },
        pageUrl: "https://zoom.us",
        pageTitle: "Zoom"
      },
      {
        id: "rows",
        timestamp: 2,
        type: "selectRows",
        selectors: {},
        rowSelection: { mode: "firstAvailable", count: 4, minimumCount: 4, entityKind: "phoneNumber", valuePattern: "\\+61[\\s().-]*2[\\d\\s().-]{6,}" },
        pageUrl: "https://zoom.us",
        pageTitle: "Zoom"
      }
    ],
    assertions: [],
    config: { startUrl: "https://zoom.us", requiresImpersonation: true, defaultTimeout: 10000, retryableErrors: [] }
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
