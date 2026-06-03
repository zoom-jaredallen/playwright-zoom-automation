/**
 * Popup script — manages the Record/Stop/Review/Export UI flow.
 */
import type { ExtensionMessage, RecordedAction, RecordedWorkflow } from "../shared/types.js";

// ─── DOM Elements ────────────────────────────────────────────────────────────

const idleView = document.getElementById("idle-view")!;
const recordingView = document.getElementById("recording-view")!;
const reviewView = document.getElementById("review-view")!;
const actionCountEl = document.getElementById("action-count")!;
const actionListEl = document.getElementById("action-list")!;
const parameterListEl = document.getElementById("parameter-list")!;
const workflowNameInput = document.getElementById("workflow-name") as HTMLInputElement;
const workflowCategorySelect = document.getElementById("workflow-category") as HTMLSelectElement;

const btnStart = document.getElementById("btn-start")!;
const btnStop = document.getElementById("btn-stop")!;
const btnExportJson = document.getElementById("btn-export-json")!;
const btnExportSync = document.getElementById("btn-export-sync")!;
const btnCopy = document.getElementById("btn-copy")!;
const btnNew = document.getElementById("btn-new")!;
const btnOpenPanel = document.getElementById("btn-open-panel")!;
const btnOpenPanelRecording = document.getElementById("btn-open-panel-recording")!;
const btnOpenPanelReview = document.getElementById("btn-open-panel-review")!;

let currentWorkflow: RecordedWorkflow | undefined;
let currentActions: RecordedAction[] = [];

// ─── Initialization ──────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const response = await sendMessage({ type: "GET_STATUS" });
  if (response?.recording) {
    showView("recording");
    actionCountEl.textContent = String(response.actionCount ?? 0);
    await refreshActionList();
  } else {
    // Check if there's a completed workflow to review
    const stored = await chrome.storage.local.get(["lastWorkflow", "lastActions"]);
    if (stored.lastWorkflow) {
      currentWorkflow = stored.lastWorkflow;
      currentActions = stored.lastActions ?? [];
      showView("review");
      populateReview();
    } else {
      showView("idle");
    }
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

btnStart.addEventListener("click", async () => {
  btnStart.setAttribute("disabled", "true");
  try {
    const response = await sendMessage({ type: "START_RECORDING" });
    if (!response?.ok) {
      alert(`Could not start recording: ${response?.error ?? "Unknown error"}`);
      showView("idle");
      return;
    }

    showView("recording");
    actionCountEl.textContent = "0";
    actionListEl.innerHTML = "";
  } catch (error) {
    alert(`Could not start recording: ${error instanceof Error ? error.message : String(error)}`);
    showView("idle");
  } finally {
    btnStart.removeAttribute("disabled");
  }
});

btnStop.addEventListener("click", async () => {
  const response = await sendMessage({ type: "STOP_RECORDING" });
  if (response?.workflow) {
    currentWorkflow = response.workflow;
    currentActions = response.workflow.actions;
    showView("review");
    populateReview();
  }
});

btnExportJson.addEventListener("click", () => {
  if (!currentWorkflow) return;
  finalizeWorkflow();
  const blob = new Blob([JSON.stringify(currentWorkflow, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(currentWorkflow.meta.name || "workflow")}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

btnExportSync.addEventListener("click", async () => {
  if (!currentWorkflow) return;
  finalizeWorkflow();
  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/api/workflows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: currentWorkflow, options: { compile: true, enableImmediately: true } })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Unknown error" }));
      alert(`Sync failed: ${body.error ?? response.statusText}`);
      return;
    }
    const result = await response.json();
    // Open the automation console so the user can select accounts and run
    chrome.tabs.create({ url: `${serverUrl}/#workflows` });
    alert(`✓ Workflow "${currentWorkflow.meta.name}" synced!\nID: ${result.id}\n\nThe Automation Console is opening — select sub-accounts and start a run.`);
  } catch (error) {
    alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

btnCopy.addEventListener("click", () => {
  if (!currentWorkflow) return;
  finalizeWorkflow();
  navigator.clipboard.writeText(JSON.stringify(currentWorkflow, null, 2));
  btnCopy.textContent = "✓ Copied!";
  setTimeout(() => { btnCopy.textContent = "Copy JSON"; }, 2000);
});

btnNew.addEventListener("click", () => {
  currentWorkflow = undefined;
  currentActions = [];
  chrome.storage.local.remove(["lastWorkflow", "lastActions"]);
  showView("idle");
});

btnOpenPanel.addEventListener("click", () => void openSidePanel());
btnOpenPanelRecording.addEventListener("click", () => void openSidePanel());
btnOpenPanelReview.addEventListener("click", () => void openSidePanel());

// ─── Listen for live action updates ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "STATUS_RESPONSE" && message.recording) {
    actionCountEl.textContent = String(message.actionCount);
  }
  if (message.type === "ACTION_RECORDED") {
    appendActionToList(message.action);
    actionCountEl.textContent = String(parseInt(actionCountEl.textContent ?? "0") + 1);
  }
});

// ─── View Management ─────────────────────────────────────────────────────────

function showView(view: "idle" | "recording" | "review"): void {
  idleView.classList.toggle("hidden", view !== "idle");
  recordingView.classList.toggle("hidden", view !== "recording");
  reviewView.classList.toggle("hidden", view !== "review");
}

// ─── Action List ─────────────────────────────────────────────────────────────

async function refreshActionList(): Promise<void> {
  const response = await sendMessage({ type: "GET_ACTIONS" });
  if (response?.actions) {
    actionListEl.innerHTML = "";
    for (const action of response.actions) {
      appendActionToList(action);
    }
  }
}

function appendActionToList(action: RecordedAction): void {
  const item = document.createElement("div");
  item.className = "action-item";
  item.dataset.id = action.id;
  item.innerHTML = `
    <span class="action-type">${action.type}</span>
    <span class="action-desc">${escapeHtml(action.description ?? action.value ?? action.url ?? "")}</span>
    <button class="action-delete" title="Remove this action">×</button>
  `;
  item.querySelector(".action-delete")!.addEventListener("click", async () => {
    await sendMessage({ type: "DELETE_ACTION", actionId: action.id });
    item.remove();
    actionCountEl.textContent = String(Math.max(0, parseInt(actionCountEl.textContent ?? "1") - 1));
  });
  actionListEl.appendChild(item);
  actionListEl.scrollTop = actionListEl.scrollHeight;
}

// ─── Review & Parameters ─────────────────────────────────────────────────────

function populateReview(): void {
  if (!currentWorkflow) return;

  workflowNameInput.value = currentWorkflow.meta.name;
  workflowCategorySelect.value = currentWorkflow.meta.category;

  // Populate parameters
  parameterListEl.innerHTML = "";
  const allParams = collectAllParameters(currentActions);

  if (allParams.length === 0) {
    parameterListEl.innerHTML = '<p class="hint">No account-specific values detected.</p>';
    return;
  }

  for (const { actionId, paramIndex, hint } of allParams) {
    const item = document.createElement("div");
    item.className = "param-item";
    item.innerHTML = `
      <span class="param-name">{{${hint.suggestedName}}}</span>
      <span class="param-value" title="${escapeHtml(hint.originalValue)}">${escapeHtml(hint.originalValue)}</span>
      <div class="param-actions">
        <button class="param-btn ${hint.confirmed !== false ? "confirmed" : ""}" data-action="confirm" title="Keep as parameter">✓</button>
        <button class="param-btn ${hint.confirmed === false ? "dismissed" : ""}" data-action="dismiss" title="Keep as literal value">×</button>
      </div>
    `;
    item.querySelector('[data-action="confirm"]')!.addEventListener("click", () => {
      sendMessage({ type: "UPDATE_PARAMETER", actionId, paramIndex, confirmed: true });
      hint.confirmed = true;
      item.querySelector('[data-action="confirm"]')!.classList.add("confirmed");
      item.querySelector('[data-action="dismiss"]')!.classList.remove("dismissed");
    });
    item.querySelector('[data-action="dismiss"]')!.addEventListener("click", () => {
      sendMessage({ type: "UPDATE_PARAMETER", actionId, paramIndex, confirmed: false });
      hint.confirmed = false;
      item.querySelector('[data-action="dismiss"]')!.classList.add("dismissed");
      item.querySelector('[data-action="confirm"]')!.classList.remove("confirmed");
    });
    parameterListEl.appendChild(item);
  }
}

function collectAllParameters(actions: RecordedAction[]): Array<{ actionId: string; paramIndex: number; hint: { suggestedName: string; originalValue: string; confirmed?: boolean } }> {
  const results: Array<{ actionId: string; paramIndex: number; hint: { suggestedName: string; originalValue: string; confirmed?: boolean } }> = [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (!action.parameterHints) continue;
    for (let i = 0; i < action.parameterHints.length; i++) {
      const hint = action.parameterHints[i];
      if (seen.has(hint.suggestedName)) continue;
      seen.add(hint.suggestedName);
      results.push({ actionId: action.id, paramIndex: i, hint });
    }
  }

  return results;
}

// ─── Finalization ────────────────────────────────────────────────────────────

function finalizeWorkflow(): void {
  if (!currentWorkflow) return;
  currentWorkflow.meta.name = workflowNameInput.value || "Untitled Workflow";
  currentWorkflow.meta.category = workflowCategorySelect.value as RecordedWorkflow["meta"]["category"];
}

// ─── Utilities ───────────────────────────────────────────────────────────────

async function sendMessage(message: ExtensionMessage): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

async function getServerUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("serverUrl");
  return stored.serverUrl ?? "http://localhost:4174";
}

async function openSidePanel(): Promise<void> {
  if (!chrome.sidePanel?.open) {
    alert("Chrome side panel is not available in this browser.");
    return;
  }

  const window = await chrome.windows.getCurrent();
  if (!window.id) {
    alert("Could not determine the active Chrome window.");
    return;
  }

  await chrome.sidePanel.open({ windowId: window.id });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

init();
