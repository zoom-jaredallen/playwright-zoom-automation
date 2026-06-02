import type { ReactNode } from "react";
import { BoltIcon, CheckIcon, SearchIcon, SettingsIcon } from "./Icons.js";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
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
        <div className="topbar-search">
          <SearchIcon />
          <span>Search runs, accounts, or workflows</span>
        </div>
        <div className="topbar-spacer" />
        <button className="icon-button" aria-label="Run activity">
          <BoltIcon />
        </button>
        <div className="avatar" aria-label="Signed in user">
          ZA
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
              <button className="fab" aria-label="Create run">
                +
              </button>
            </div>
            <nav className="feature-nav">
              <a className="feature-nav-item active" href="#accounts">
                <SearchIcon />
                Accounts
              </a>
              <a className="feature-nav-item" href="#workflows">
                <BoltIcon />
                Workflows
              </a>
              <a className="feature-nav-item" href="#run">
                <CheckIcon />
                Current run
              </a>
              <a className="feature-nav-item" href="#settings">
                <SettingsIcon />
                Settings
              </a>
            </nav>
            <div className="left-nav-section">
              <p className="section-label">Saved scopes</p>
              <button className="scope-chip active">Lab494 s301-s350</button>
              <button className="scope-chip">Manual selection</button>
            </div>
            <div className="left-nav-footer">Local in-memory release</div>
          </aside>

          <section className="content-area">{children}</section>
        </main>
      </div>
    </div>
  );
}
