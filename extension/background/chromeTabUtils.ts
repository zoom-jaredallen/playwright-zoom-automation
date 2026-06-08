import type { ExtensionMessage } from "../shared/types.js";

export type TestTab = chrome.tabs.Tab & { id: number };

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found");
  }
  return tab;
}

export async function ensureContentRecorder(tabId: number): Promise<void> {
  if (await contentRecorderResponds(tabId)) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/recorder.js"]
  });

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await contentRecorderResponds(tabId)) {
      return;
    }
    await sleep(100);
  }

  throw new Error("Recorder content script did not initialize in the active tab");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function contentRecorderResponds(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GET_STATUS" } satisfies ExtensionMessage);
    return true;
  } catch {
    return false;
  }
}
