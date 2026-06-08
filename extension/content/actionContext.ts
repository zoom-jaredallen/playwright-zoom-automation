import type { RecordedAction } from "../shared/types.js";
import { highlightElement } from "./domHelpers.js";
import { findReplayElementSync } from "./replayRunner.js";

export function currentFrameContext(): { frameId: number } {
  try {
    return { frameId: window.top === window ? 0 : 1 };
  } catch {
    return { frameId: 1 };
  }
}

export async function highlightActionTarget(action: RecordedAction): Promise<{ ok: boolean; error?: string }> {
  const element = findReplayElementSync(action);
  if (!element) {
    return { ok: false, error: "No element matched this step on the current page." };
  }
  highlightElement(element);
  return { ok: true };
}

export function captureMetadataForTarget(element: Element): RecordedAction["capture"] {
  const rect = element.getBoundingClientRect();
  return {
    capturedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    targetBox: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}

export function actionLabel(action: RecordedAction): string {
  return action.selectors.role?.name ?? action.selectors.text ?? action.selectors.label ?? action.description ?? "";
}
