/**
 * Background service worker that aggregates recorded actions from the content
 * script, manages recording state, and generates the final workflow JSON.
 */
import type { ExtensionMessage, RecordedAction, RecordedWorkflow, WorkflowAssertion, WorkflowParameter } from "../shared/types.js";

let recording = false;
let actions: RecordedAction[] = [];
let recordingStartTime = 0;
let recordingStartUrl = "";

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  switch (message.type) {
    case "START_RECORDING":
      recording = true;
      actions = [];
      recordingStartTime = Date.now();
      recordingStartUrl = "";
      // Forward to content script
      forwardToActiveTab(message);
      updateBadge();
      sendResponse({ ok: true });
      break;

    case "STOP_RECORDING":
      recording = false;
      forwardToActiveTab(message);
      updateBadge();
      const workflow = buildWorkflow();
      sendResponse({ ok: true, workflow });
      // Store the workflow for the popup to retrieve
      chrome.storage.local.set({ lastWorkflow: workflow, lastActions: actions });
      break;

    case "ACTION_RECORDED":
      if (recording) {
        actions.push(message.action);
        if (!recordingStartUrl && message.action.type === "navigate") {
          recordingStartUrl = message.action.url ?? "";
        }
        updateBadge();
        // Notify popup of new action count
        chrome.runtime.sendMessage({
          type: "STATUS_RESPONSE",
          recording: true,
          actionCount: actions.length
        } satisfies ExtensionMessage).catch(() => undefined);
      }
      sendResponse({ ok: true });
      break;

    case "GET_STATUS":
      sendResponse({ recording, actionCount: actions.length });
      break;

    case "GET_ACTIONS":
      sendResponse({ actions });
      break;

    case "DELETE_ACTION":
      actions = actions.filter((a) => a.id !== message.actionId);
      updateBadge();
      sendResponse({ ok: true });
      break;

    case "UPDATE_PARAMETER":
      const action = actions.find((a) => a.id === message.actionId);
      if (action?.parameterHints?.[message.paramIndex]) {
        action.parameterHints[message.paramIndex].confirmed = message.confirmed;
      }
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false, error: "Unknown message type" });
  }
  return true;
});

// ─── Workflow Builder ────────────────────────────────────────────────────────

function buildWorkflow(): RecordedWorkflow {
  const parameters = extractParameters(actions);
  const assertions = generateAssertions(actions);
  const startUrl = extractRelativeStartUrl(recordingStartUrl);

  return {
    version: 1,
    meta: {
      name: "",
      description: generateDescription(actions),
      recordedAt: new Date().toISOString(),
      recordedOnUrl: recordingStartUrl,
      durationMs: Date.now() - recordingStartTime,
      category: inferCategory(actions)
    },
    parameters,
    actions: actions.map((action) => ({
      ...action,
      // Replace confirmed parameter values with template placeholders
      value: replaceWithPlaceholders(action)
    })),
    assertions,
    config: {
      startUrl,
      requiresImpersonation: true,
      defaultTimeout: 10_000,
      retryableErrors: [
        "timeout",
        "temporarily unavailable",
        "net::",
        "target closed"
      ]
    }
  };
}

function extractParameters(actions: RecordedAction[]): WorkflowParameter[] {
  const paramMap = new Map<string, WorkflowParameter>();

  for (const action of actions) {
    if (!action.parameterHints) continue;
    for (const hint of action.parameterHints) {
      if (hint.confirmed === false) continue; // User explicitly dismissed
      if (paramMap.has(hint.suggestedName)) continue;

      paramMap.set(hint.suggestedName, {
        name: hint.suggestedName,
        type: hint.reason === "looks_like_phone_number" ? "string" : "string",
        required: true,
        description: `Auto-detected: ${hint.reason.replace(/_/g, " ")}`,
        defaultValue: undefined,
        source: inferParameterSource(hint.suggestedName)
      });
    }
  }

  return Array.from(paramMap.values());
}

function inferParameterSource(paramName: string): WorkflowParameter["source"] {
  if (paramName.startsWith("address.")) return "addressProfile";
  if (paramName === "customerName") return "addressProfile";
  if (paramName.startsWith("contact.")) return "addressProfile";
  if (paramName === "contactEmail") return "addressProfile";
  if (paramName === "phoneNumber") return "config";
  return "prompt";
}

function generateAssertions(actions: RecordedAction[]): WorkflowAssertion[] {
  const assertions: WorkflowAssertion[] = [];

  for (const action of actions) {
    // After click on Save/Submit buttons, add success assertion
    if (action.type === "click") {
      const name = action.selectors.role?.name ?? action.selectors.text ?? "";
      if (/save|submit|add|continue|confirm/i.test(name)) {
        assertions.push({
          afterAction: action.id,
          type: "textVisible",
          expected: "success|saved|added|submitted",
          timeout: 10_000,
          onFailure: "screenshot"
        });
      }
    }

    // After navigation, assert URL
    if (action.type === "navigate" && action.url) {
      const path = new URL(action.url).hash || new URL(action.url).pathname;
      assertions.push({
        afterAction: action.id,
        type: "urlContains",
        expected: path,
        timeout: 15_000,
        onFailure: "fail"
      });
    }
  }

  return assertions;
}

function replaceWithPlaceholders(action: RecordedAction): string | undefined {
  if (!action.value || !action.parameterHints) return action.value;

  let value = action.value;
  for (const hint of action.parameterHints) {
    if (hint.confirmed === false) continue;
    value = value.replace(hint.originalValue, `{{${hint.suggestedName}}}`);
  }
  return value;
}

function generateDescription(actions: RecordedAction[]): string {
  const fills = actions.filter((a) => a.type === "fill").length;
  const clicks = actions.filter((a) => a.type === "click").length;
  const navigations = actions.filter((a) => a.type === "navigate").length;
  return `Recorded workflow: ${navigations} navigation(s), ${fills} field fill(s), ${clicks} click(s).`;
}

function inferCategory(actions: RecordedAction[]): RecordedWorkflow["meta"]["category"] {
  const urls = actions.map((a) => a.pageUrl).join(" ");
  if (/phoneNumbers|business-address|phone/i.test(urls)) return "phone";
  if (/settings|policy|policies/i.test(urls)) return "settings";
  if (/compliance|10dlc|brand/i.test(urls)) return "compliance";
  return "custom";
}

function extractRelativeStartUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return url.pathname + url.hash;
  } catch {
    return "/";
  }
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function updateBadge(): void {
  if (recording) {
    chrome.action.setBadgeText({ text: String(actions.length) });
    chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function forwardToActiveTab(message: ExtensionMessage): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch {
    // Tab may not have content script loaded
  }
}
