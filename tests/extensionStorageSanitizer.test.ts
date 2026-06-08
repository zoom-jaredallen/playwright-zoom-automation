import { describe, expect, it } from "vitest";
import type { RecordedAction, RecordedWorkflow } from "@zoom-automation/workflow-core";
import { stripStorageHeavyActionFields, stripStorageHeavyActions, stripStorageHeavyWorkflowFields } from "../extension/shared/storageSanitizer.js";

describe("extension storage sanitizer", () => {
  it("removes base64 thumbnail payloads before extension storage persistence", () => {
    const action = makeAction("a1");

    const sanitized = stripStorageHeavyActionFields(action);

    expect(sanitized.capture?.thumbnail).toBeUndefined();
    expect(sanitized.capture?.targetBox).toEqual(action.capture?.targetBox);
    expect(action.capture?.thumbnail?.dataUrl).toContain("base64");
  });

  it("sanitizes action arrays without mutating the runtime actions", () => {
    const actions = [makeAction("a1"), makeAction("a2")];

    const sanitized = stripStorageHeavyActions(actions);

    expect(sanitized.every((action) => !action.capture?.thumbnail)).toBe(true);
    expect(actions.every((action) => action.capture?.thumbnail?.dataUrl)).toBe(true);
  });

  it("sanitizes workflow actions while preserving workflow metadata", () => {
    const workflow: RecordedWorkflow = {
      version: 1,
      meta: {
        name: "Large Workflow",
        description: "Contains screenshots",
        recordedAt: "2026-06-08T00:00:00.000Z",
        recordedOnUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        durationMs: 100,
        category: "phone"
      },
      parameters: [],
      actions: [makeAction("a1")],
      assertions: [],
      config: {
        startUrl: "https://zoom.us/cpw/page/phoneNumbers#/number-list",
        requiresImpersonation: true,
        defaultTimeout: 10_000,
        retryableErrors: []
      }
    };

    const sanitized = stripStorageHeavyWorkflowFields(workflow);

    expect(sanitized.meta.name).toBe("Large Workflow");
    expect(sanitized.actions[0]?.capture?.thumbnail).toBeUndefined();
    expect(workflow.actions[0]?.capture?.thumbnail?.dataUrl).toContain("base64");
  });
});

function makeAction(id: string): RecordedAction {
  return {
    id,
    timestamp: 1,
    type: "click",
    selectors: { role: { role: "button", name: "Save" } },
    pageUrl: "https://zoom.us",
    pageTitle: "Zoom",
    capture: {
      pageUrl: "https://zoom.us",
      viewport: { width: 1920, height: 1080 },
      targetBox: { x: 10, y: 20, width: 100, height: 30 },
      thumbnail: {
        dataUrl: `data:image/jpeg;base64,${"a".repeat(100_000)}`,
        width: 420,
        height: 236
      },
      capturedAt: "2026-06-08T00:00:00.000Z"
    }
  };
}
