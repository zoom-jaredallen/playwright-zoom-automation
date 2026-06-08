import type { RecordedAction } from "../shared/types.js";

export async function withVisibleTabThumbnail(action: RecordedAction, tab: chrome.tabs.Tab | undefined): Promise<RecordedAction> {
  if (!action.capture || tab?.windowId === undefined) return action;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 35 });
    const width = Math.min(action.capture.viewport.width, 420);
    const height = Math.round(width * (action.capture.viewport.height / Math.max(action.capture.viewport.width, 1)));
    return {
      ...action,
      capture: {
        ...action.capture,
        thumbnail: { dataUrl, width, height }
      }
    };
  } catch {
    return action;
  }
}
