import { useEffect, useRef } from "react";
import type { JobView, SubAccountView } from "../api.js";

interface AccountDrawerProps {
  open: boolean;
  account?: SubAccountView;
  accountState?: JobView["accounts"][number];
  onClose(): void;
}

export function AccountDrawer({ open, account, accountState, onClose }: AccountDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [open]);

  if (!open || !account) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-label={`Details for ${account.name}`}
        tabIndex={-1}
      >
        <div className="drawer-header">
          <h3>{account.name}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>

        <div className="drawer-body">
          <dl className="drawer-fields">
            <div>
              <dt>Account ID</dt>
              <dd><code>{account.id}</code></dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{account.ownerEmail ?? account.ownerName ?? "—"}</dd>
            </div>
            {accountState ? (
              <>
                <div>
                  <dt>Last run status</dt>
                  <dd>
                    <span className={`status-badge ${statusClass(accountState.status)}`}>
                      {accountState.status.charAt(0).toUpperCase() + accountState.status.slice(1)}
                    </span>
                  </dd>
                </div>
                {accountState.workflowId ? (
                  <div>
                    <dt>Workflow</dt>
                    <dd>{accountState.workflowId}</dd>
                  </div>
                ) : null}
                {accountState.message ? (
                  <div className="wide">
                    <dt>Message</dt>
                    <dd className="drawer-message">{accountState.message}</dd>
                  </div>
                ) : null}
                {accountState.error ? (
                  <div className="wide">
                    <dt>Error</dt>
                    <dd className="drawer-error">{accountState.error}</dd>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="wide">
                <dt>Status</dt>
                <dd className="drawer-message">No run data available for this account.</dd>
              </div>
            )}
          </dl>

          {accountState?.status === "failed" ? (
            <div className="drawer-artifacts">
              <h4>Artifacts</h4>
              <p className="drawer-hint">
                Screenshots and traces are saved to <code>output/artifacts/</code> on the server.
                Look for files matching <code>{account.id.slice(0, 12)}*</code>.
              </p>
              <a
                className="tertiary-button"
                href={`/artifacts/artifacts/${account.id.replace(/[^a-z0-9_.-]/gi, "_")}*`}
                target="_blank"
                rel="noopener"
              >
                Browse artifacts →
              </a>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function statusClass(status: string): string {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "primary";
  return "neutral";
}
