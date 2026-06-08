import type { ExtensionMessage, RecordedAction } from "../shared/types.js";

export const SUBMIT_LABEL_PATTERN = /save|submit|add|continue|next|confirm|apply|create|update/i;

const recentNetworkEntries: Array<{ url: string; startTime: number }> = [];

export function startNetworkObserver(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        if (resource.initiatorType === "xmlhttprequest" || resource.initiatorType === "fetch") {
          recentNetworkEntries.push({ url: resource.name, startTime: resource.startTime });
          if (recentNetworkEntries.length > 50) recentNetworkEntries.shift();
        }
      }
    });
    observer.observe({ type: "resource", buffered: false });
  } catch {
    // Resource timing is unavailable on some pages; network-aware waits degrade gracefully.
  }
}

export function captureNetworkWaitFor(action: RecordedAction): void {
  const since = performance.now();
  setTimeout(() => {
    const triggered = recentNetworkEntries.find((entry) => entry.startTime >= since - 50);
    if (!triggered) return;
    const path = stableNetworkPath(triggered.url);
    if (!path) return;
    chrome.runtime.sendMessage({
      type: "UPDATE_ACTION",
      actionId: action.id,
      networkWaitUrl: path
    } satisfies ExtensionMessage);
  }, 1_200);
}

function stableNetworkPath(url: string): string | undefined {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname && parsed.pathname !== "/") return parsed.pathname;
  } catch {
    // Ignore non-URL resource names.
  }
  return undefined;
}
