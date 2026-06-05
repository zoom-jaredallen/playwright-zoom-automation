import type { ExtensionMessage } from "../shared/types.js";

const enabledToggle = mustGet("extension-enabled") as HTMLInputElement;
const enabledPill = mustGet("enabled-pill");
const recordingPill = mustGet("recording-pill");
const statusText = mustGet("status-text");
const serverUrlEl = mustGet("server-url");
const connectionPill = mustGet("connection-pill");
const connectionMessage = mustGet("connection-message");
const btnOpenPanel = mustGet("btn-open-panel") as HTMLButtonElement;
const btnCheckConnection = mustGet("btn-check-connection") as HTMLButtonElement;
const btnOpenWebUi = mustGet("btn-open-web-ui") as HTMLButtonElement;

let sidePanelTabId: number | undefined;
let sidePanelWindowId: number | undefined;

void init();

async function init(): Promise<void> {
  await captureSidePanelOpenContext();
  await refreshEnabledState();
  await refreshRecorderStatus();
  await renderServerUrl();

  enabledToggle.addEventListener("change", () => void setExtensionEnabled(enabledToggle.checked));
  btnOpenPanel.addEventListener("click", () => void openSidePanel());
  btnCheckConnection.addEventListener("click", () => void checkConnection());
  btnOpenWebUi.addEventListener("click", () => void openWebUi());
}

async function refreshEnabledState(): Promise<void> {
  const enabled = await getExtensionEnabled();
  renderEnabledState(enabled);
}

async function setExtensionEnabled(enabled: boolean): Promise<void> {
  enabledToggle.disabled = true;
  try {
    await sendMessage({ type: "SET_EXTENSION_ENABLED", enabled });
    renderEnabledState(enabled);
    await refreshRecorderStatus();
  } catch (error) {
    enabledToggle.checked = !enabled;
    connectionMessage.textContent = `Could not update extension state: ${formatError(error)}`;
  } finally {
    enabledToggle.disabled = false;
  }
}

function renderEnabledState(enabled: boolean): void {
  enabledToggle.checked = enabled;
  enabledPill.textContent = enabled ? "Enabled" : "Disabled";
  enabledPill.className = `pill${enabled ? "" : " error"}`;
  statusText.textContent = enabled ? "Recorder controls are available." : "Capture and preflight are disabled.";
}

async function refreshRecorderStatus(): Promise<void> {
  const status = await sendMessage({ type: "GET_STATUS" });
  const recording = Boolean(status?.recording);
  const paused = Boolean(status?.paused);
  const count = Number(status?.actionCount ?? 0);
  recordingPill.textContent = recording ? paused ? "Paused" : `Recording ${count}` : "Idle";
  recordingPill.className = `pill ${recording ? paused ? "warning" : "error" : "neutral"}`;
}

async function renderServerUrl(): Promise<void> {
  const serverUrl = await getServerUrl();
  serverUrlEl.textContent = serverUrl.replace(/^https?:\/\//, "");
  serverUrlEl.title = serverUrl;
}

async function checkConnection(): Promise<void> {
  const serverUrl = await getServerUrl();
  connectionPill.textContent = "Checking";
  connectionPill.className = "pill warning";
  connectionMessage.textContent = "";
  btnCheckConnection.disabled = true;

  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/health`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json().catch(() => undefined);
    if (!body?.ok) {
      throw new Error("Health endpoint did not return ok.");
    }
    connectionPill.textContent = "Connected";
    connectionPill.className = "pill";
    connectionMessage.textContent = `Connected to ${serverUrl}.`;
  } catch (error) {
    connectionPill.textContent = "Not reachable";
    connectionPill.className = "pill error";
    connectionMessage.textContent = `Could not reach ${serverUrl}: ${formatError(error)}`;
  } finally {
    btnCheckConnection.disabled = false;
  }
}

async function openWebUi(): Promise<void> {
  const serverUrl = await getServerUrl();
  await chrome.tabs.create({ url: serverUrl });
}

async function getExtensionEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get("extensionEnabled");
  return stored.extensionEnabled !== false;
}

async function getServerUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("serverUrl");
  return stored.serverUrl ?? "http://localhost:4174";
}

async function openSidePanel(): Promise<void> {
  if (!chrome.sidePanel?.open) {
    await openRecorderInTab();
    return;
  }

  try {
    if (sidePanelTabId !== undefined) {
      await chrome.sidePanel.open({ tabId: sidePanelTabId });
      await chrome.sidePanel.setOptions({
        tabId: sidePanelTabId,
        path: "sidepanel/sidepanel.html",
        enabled: true
      });
      return;
    }

    if (sidePanelWindowId !== undefined) {
      await chrome.sidePanel.open({ windowId: sidePanelWindowId });
      return;
    }

    throw new Error("No active tab or window was available for the side panel.");
  } catch (error) {
    console.warn("Falling back to recorder tab because side panel could not open", error);
    await openRecorderInTab();
  }
}

async function captureSidePanelOpenContext(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  sidePanelTabId = tab?.id;
  sidePanelWindowId = tab?.windowId;
}

async function openRecorderInTab(): Promise<void> {
  const url = chrome.runtime.getURL("sidepanel/sidepanel.html");
  await chrome.tabs.create({ url });
}

async function sendMessage(message: ExtensionMessage): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}
