import type { RecordedAction } from "@zoom-automation/workflow-core";

export interface NavigationRecordingContext {
  frameId?: number;
}

/**
 * Zoom embeds SDK/cross-storage pages in frames while users interact with the
 * admin UI. Those pages can emit navigation events but are not replayable
 * workflow intent, so they should never seed workflow start URLs or steps.
 */
export function isIgnoredRecorderNavigationUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname.endsWith("ccistatic.zoom.us") && pathname.includes("/web-sdk/")) {
      return true;
    }

    if (hostname.endsWith(".zoom.us") && pathname.endsWith("/cross-storage.html")) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function shouldRecordNavigationUrl(rawUrl: string | undefined, context: NavigationRecordingContext = {}): boolean {
  if (!rawUrl) return false;
  if (context.frameId !== undefined && context.frameId !== 0) return false;
  return !isIgnoredRecorderNavigationUrl(rawUrl);
}

export function shouldAcceptRecordedAction(action: RecordedAction, context: NavigationRecordingContext = {}): boolean {
  if (isIgnoredRecorderNavigationUrl(action.pageUrl)) return false;
  if (action.type === "navigate") {
    return shouldRecordNavigationUrl(action.url ?? action.pageUrl, context);
  }
  return true;
}

export function firstRecordableNavigationUrl(actions: RecordedAction[]): string | undefined {
  return actions.find((action) => action.type === "navigate" && shouldRecordNavigationUrl(action.url ?? action.pageUrl))?.url;
}
