import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRecorderDebugStore } from "../src/server/services/recorderDebugStore.js";

describe("recorder debug store", () => {
  it("stores a snapshot as latest and appends structured events", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-"));
    const store = createRecorderDebugStore({ directory: dir });
    const snapshot = store.saveSnapshot({
      sessionId: "session-1",
      timestamp: "2026-06-07T00:00:00.000Z",
      source: "extension",
      status: { recording: false, paused: false, actionCount: 1 },
      rawActions: [recordedNavigateAction()],
      preparedActions: [recordedNavigateAction()],
      workflow: undefined,
      quality: undefined,
      testState: { running: false, events: [] },
      page: {
        url: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
        title: "Business Address"
      }
    });

    expect(snapshot.sessionId).toBe("session-1");
    expect(store.latest()?.sessionId).toBe("session-1");
    expect(store.listSessions()).toEqual([
      expect.objectContaining({ sessionId: "session-1", actionCount: 1, url: snapshot.page?.url })
    ]);

    const events = readFileSync(path.join(dir, "session-1", "events.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(events[0])).toMatchObject({ event: "snapshot_saved", sessionId: "session-1" });
  });

  it("creates pending commands and records command results", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "recorder-debug-"));
    const store = createRecorderDebugStore({ directory: dir });
    const command = store.createCommand({ type: "RUN_TEST_WORKFLOW", payload: {} });

    expect(command.status).toBe("pending");
    expect(store.nextPendingCommand()?.id).toBe(command.id);

    store.markCommandResult(command.id, {
      ok: true,
      events: [{ timestamp: 1, level: "success", message: "done" }]
    });

    expect(store.getCommand(command.id)?.status).toBe("completed");
    expect(store.nextPendingCommand()).toBeUndefined();
  });
});

function recordedNavigateAction() {
  return {
    id: "a1",
    type: "navigate" as const,
    timestamp: 1,
    selectors: {},
    pageUrl: "https://zoom.us/cpw/page/phoneNumbers#/business-address",
    pageTitle: "Business Address",
    url: "https://zoom.us/cpw/page/phoneNumbers#/business-address"
  };
}
