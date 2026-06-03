import { useCallback, useRef, useState } from "react";

interface ImportWorkflowProps {
  onImported(result: { id: string; name: string; warnings?: string[] }): void;
  onCancel(): void;
}

export function ImportWorkflow({ onImported, onCancel }: ImportWorkflowProps) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ name: string; actions: number; parameters: number } | undefined>();
  const [rawJson, setRawJson] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(undefined);
    setPreview(undefined);
    try {
      const text = await file.text();
      parseAndPreview(text);
    } catch (err) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const parseAndPreview = (text: string) => {
    try {
      const workflow = JSON.parse(text);
      if (!workflow.meta?.name || !workflow.actions) {
        setError("Invalid workflow file. Expected a recorded workflow JSON with 'meta' and 'actions' fields.");
        return;
      }
      setRawJson(text);
      setPreview({
        name: workflow.meta.name,
        actions: workflow.actions.length,
        parameters: workflow.parameters?.length ?? 0
      });
    } catch {
      setError("Invalid JSON. Please provide a valid recorded workflow file.");
    }
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData("text");
    if (text && text.trim().startsWith("{")) {
      parseAndPreview(text);
    }
  }, []);

  const handleImport = async () => {
    if (!rawJson) return;
    setImporting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/workflows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: JSON.parse(rawJson),
          options: { compile: true, enableImmediately: true }
        })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `Import failed (${response.status})`);
        return;
      }
      onImported({ id: body.id, name: body.name ?? preview?.name ?? "Imported workflow", warnings: body.warnings });
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="import-workflow">
      <div className="import-header">
        <h3>Import Recorded Workflow</h3>
        <p>Import a workflow JSON file exported from the Chrome extension.</p>
      </div>

      {/* Drop zone */}
      <div
        className={`import-dropzone ${dragging ? "dragging" : ""} ${preview ? "has-preview" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
      >
        {preview ? (
          <div className="import-preview">
            <span className="import-preview-icon">✓</span>
            <div className="import-preview-info">
              <strong>{preview.name}</strong>
              <small>{preview.actions} steps • {preview.parameters} parameters</small>
            </div>
            <button className="tertiary-button" onClick={() => { setPreview(undefined); setRawJson(undefined); }}>
              Clear
            </button>
          </div>
        ) : (
          <div className="import-dropzone-content">
            <span className="import-dropzone-icon">📂</span>
            <p><strong>Drop workflow JSON here</strong></p>
            <p>or <button className="import-browse-btn" onClick={() => fileInputRef.current?.click()}>browse files</button> or paste JSON</p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {/* Paste area */}
      {!preview ? (
        <div className="import-paste-section">
          <label className="import-paste-label">Or paste workflow JSON:</label>
          <textarea
            className="import-paste-area"
            placeholder='{"version": 1, "meta": {"name": "..."}, "actions": [...], ...}'
            rows={4}
            onPaste={handlePaste}
            onChange={(e) => {
              const text = e.target.value.trim();
              if (text.startsWith("{") && text.endsWith("}")) {
                parseAndPreview(text);
              }
            }}
          />
        </div>
      ) : null}

      {/* Error */}
      {error ? <div className="import-error">{error}</div> : null}

      {/* Actions */}
      <div className="import-actions">
        <button className="tertiary-button" onClick={onCancel}>Cancel</button>
        <button
          className="primary-button"
          onClick={handleImport}
          disabled={!preview || importing}
        >
          {importing ? "Importing..." : "Import & Compile"}
        </button>
      </div>
    </div>
  );
}
