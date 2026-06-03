import { useEffect } from "react";

export interface KeyboardShortcutHandlers {
  onStartRun?: () => void;
  onQueryAccounts?: () => void;
  onCancelRun?: () => void;
  onToggleHistory?: () => void;
}

/**
 * Global keyboard shortcuts for the automation console.
 * - Cmd/Ctrl+Enter: Start run
 * - Cmd/Ctrl+Q: Query accounts (prevented from closing tab)
 * - Escape: Cancel current run
 * - Cmd/Ctrl+H: Toggle history view
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl + Enter: Start run
      if (meta && event.key === "Enter") {
        event.preventDefault();
        handlers.onStartRun?.();
        return;
      }

      // Cmd/Ctrl + Q: Query accounts (prevent browser quit on some platforms)
      if (meta && event.key === "q") {
        event.preventDefault();
        handlers.onQueryAccounts?.();
        return;
      }

      // Escape: Cancel run
      if (event.key === "Escape" && !event.metaKey && !event.ctrlKey) {
        // Only cancel if no dialog is open (dialogs handle their own Escape)
        const openDialog = document.querySelector("dialog[open]");
        if (!openDialog) {
          handlers.onCancelRun?.();
        }
        return;
      }

      // Cmd/Ctrl + H: Toggle history
      if (meta && event.key === "h") {
        event.preventDefault();
        handlers.onToggleHistory?.();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handlers.onStartRun, handlers.onQueryAccounts, handlers.onCancelRun, handlers.onToggleHistory]);
}
