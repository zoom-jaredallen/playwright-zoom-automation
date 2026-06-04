import { useEffect, useRef, useState } from "react";

interface NameDialogProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm(value: string): void;
  onCancel(): void;
}

/** A small modal that collects a single text value (e.g. a new workflow name). */
export function NameDialog({
  open,
  title,
  label = "Name",
  initialValue = "",
  confirmLabel = "Create",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel
}: NameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);

  // Reset the field whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog" onClose={onCancel}>
      <div className="confirm-dialog-content">
        <h3 className="confirm-dialog-title">{title}</h3>
        <label className="detail-label" htmlFor="name-dialog-input">{label}</label>
        <input
          id="name-dialog-input"
          className="detail-input"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <div className="confirm-dialog-actions">
          <button className="tertiary-button" onClick={onCancel}>{cancelLabel}</button>
          <button className="primary-button" onClick={submit} disabled={!value.trim()}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
