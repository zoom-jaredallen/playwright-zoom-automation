import type { ReactNode } from "react";
import { BoltIcon, CheckIcon, SearchIcon, SettingsIcon } from "./Icons.js";
import { ThemeToggle } from "./ThemeToggle.js";

interface AppShellProps {
  children: ReactNode;
  activeView?: "run" | "history" | "editor";
  onViewChange?(view: "run" | "history" | "editor"): void;
}

export function AppShell({ children, activeView = "run", onViewChange }: AppShellProps) {
  return (
    <div className="app-frame">
      <header className="topbar standalone-topbar">
        <div className="product-mark" aria-label="Automation console">
          <span className="product-logo">zoom</span>
          <div>
            <strong>Automation console</strong>
            <small>Standalone web app</small>
          </div>
        </div>
        <div className="topbar-spacer" />
        <ThemeToggle />
        <button className="icon-button" aria-label="Run activity">
          <BoltIcon />
        </button>
        <div className="avatar" aria-label="Signed in user">
          JA
        </div>
      </header>

      <div className="shell-body">
        <main className="main-panel">
          <aside className="left-nav" aria-label="Automation navigation">
            <div className="left-nav-header">
              <div>
                <p className="eyebrow">Automation</p>
                <h1>Run console</h1>
              </div>
            </div>
            <nav className="feature-nav">
              <button
                className={`feature-nav-item ${activeView === "run" ? "active" : ""}`}
                onClick={() => onViewChange?.("run")}
              >
                <BoltIcon />
                New run
              </button>
              <button
                className={`feature-nav-item ${activeView === "editor" ? "active" : ""}`}
                onClick={() => onViewChange?.("editor")}
              >
                <SettingsIcon />
                Workflow editor
              </button>
              <button
                className={`feature-nav-item ${activeView === "history" ? "active" : ""}`}
                onClick={() => onViewChange?.("history")}
              >
                <CheckIcon />
                Run history
              </button>
            </nav>
            <div className="left-nav-section">
              <p className="section-label">Quick links</p>
              <a className="scope-chip" href="#accounts">Accounts</a>
              <a className="scope-chip" href="#workflows">Workflows</a>
              <a className="scope-chip" href="#settings">Settings</a>
            </div>
            <div className="left-nav-footer">
              <button className="icon-button" aria-label="Search"><SearchIcon /></button>
              <button className="icon-button" aria-label="Settings"><SettingsIcon /></button>
            </div>
          </aside>

          <section className="content-area">{children}</section>
        </main>
      </div>
    </div>
  );
}
