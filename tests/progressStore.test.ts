import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProgressStore } from "../src/automation/progressStore.js";

describe("ProgressStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "zoom-progress-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists account status and supports resume decisions", async () => {
    const progressPath = path.join(dir, "nested", "progress.json");
    const store = new ProgressStore(progressPath);

    await store.markRunning({ id: "a1", name: "Account One" });
    await store.markCompleted({ id: "a1", name: "Account One" });

    const nextStore = new ProgressStore(progressPath);
    expect(await nextStore.shouldSkip({ id: "a1", name: "Account One" })).toBe(true);
    expect(await nextStore.shouldSkip({ id: "a2", name: "Account Two" })).toBe(false);

    const raw = JSON.parse(await readFile(progressPath, "utf8"));
    expect(raw.accounts.a1.status).toBe("completed");
    expect(raw.accounts.a1.name).toBe("Account One");
  });

  it("records failed accounts with a retryable flag", async () => {
    const store = new ProgressStore(path.join(dir, "progress.json"));

    await store.markFailed({ id: "a1", name: "Account One" }, new Error("upload failed"), true);

    const snapshot = await store.load();
    expect(snapshot.accounts.a1.status).toBe("failed");
    expect(snapshot.accounts.a1.error).toBe("upload failed");
    expect(snapshot.accounts.a1.retryable).toBe(true);
  });

  it("records skipped accounts and skips them on later runs", async () => {
    const store = new ProgressStore(path.join(dir, "progress.json"));

    await store.markSkipped({ id: "a1", name: "Account One" }, "Address already present");

    const snapshot = await store.load();
    expect(snapshot.accounts.a1.status).toBe("skipped");
    expect(snapshot.accounts.a1.message).toBe("Address already present");
    expect(await store.shouldSkip({ id: "a1", name: "Account One" })).toBe(true);
  });

  it("records completed account messages", async () => {
    const store = new ProgressStore(path.join(dir, "progress.json"));

    await store.markCompleted({ id: "a1", name: "Account One" }, "Address status: Verified");

    const snapshot = await store.load();
    expect(snapshot.accounts.a1.status).toBe("completed");
    expect(snapshot.accounts.a1.message).toBe("Address status: Verified");
  });
});
