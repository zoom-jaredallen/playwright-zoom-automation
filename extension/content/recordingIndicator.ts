export function showRecordingIndicator(paused: boolean): void {
  const existingLabel = document.querySelector("#__zoom_recorder_indicator [data-recorder-label]");
  if (existingLabel) {
    existingLabel.textContent = paused ? "Recording paused" : "Recording workflow...";
    return;
  }
  const indicator = document.createElement("div");
  indicator.id = "__zoom_recorder_indicator";
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: #e53935;
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      pointer-events: none;
    ">
      <span style="width:8px;height:8px;border-radius:50%;background:white;animation:pulse 1s infinite;"></span>
      <span data-recorder-label>${paused ? "Recording paused" : "Recording workflow..."}</span>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
  `;
  document.body.appendChild(indicator);
}

export function hideRecordingIndicator(): void {
  document.getElementById("__zoom_recorder_indicator")?.remove();
}
