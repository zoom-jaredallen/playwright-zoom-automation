import type { ExtensionMessage, RecordedAction } from "../shared/types.js";

export function updateRecorderBadge(input: { recording: boolean; paused: boolean; actionCount: number }): void {
  if (input.recording) {
    chrome.action.setBadgeText({ text: input.paused ? "II" : String(input.actionCount) });
    chrome.action.setBadgeBackgroundColor({ color: input.paused ? "#7a869a" : "#e53935" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

export function broadcastRecorderState(input: {
  recording: boolean;
  paused: boolean;
  actions: RecordedAction[];
}): void {
  chrome.runtime.sendMessage({
    type: "STATUS_RESPONSE",
    recording: input.recording,
    paused: input.paused,
    actionCount: input.actions.length
  } satisfies ExtensionMessage).catch(() => undefined);

  chrome.runtime.sendMessage({
    type: "RECORDER_STATE_UPDATED",
    recording: input.recording,
    paused: input.paused,
    actions: input.actions
  } satisfies ExtensionMessage).catch(() => undefined);
}
