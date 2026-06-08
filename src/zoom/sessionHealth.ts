/**
 * Session Health Monitor — periodically checks if the master browser session
 * is still valid and auto-recovers by re-logging in when it expires.
 */
import type { Browser, BrowserContext } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { StorageState } from "./auth.js";
import { getMasterStorageState } from "./masterSession.js";

export type SessionStatus = "healthy" | "degraded" | "expired" | "recovering";

export interface SessionHealthState {
  status: SessionStatus;
  lastCheckedAt: string;
  sessionAgeMs: number;
  refreshCount: number;
}

export interface SessionHealthMonitorOptions {
  browser: Browser;
  config: AppConfig["zoom"];
  logger: Logger;
  /** How often to check session health (ms). Default: 5 minutes. */
  checkIntervalMs?: number;
  /** Max session age before proactive refresh (ms). Default: 45 minutes. */
  maxSessionAgeMs?: number;
  /** Optional Playwright storage-state cache path for the master session. */
  storageStatePath?: string;
}

/**
 * Manages the master browser session lifecycle. Checks health periodically
 * and auto-refreshes when the session expires or approaches max age.
 */
export class SessionHealthMonitor {
  private storageState: StorageState;
  private sessionCreatedAt: number;
  private refreshCount = 0;
  private status: SessionStatus = "healthy";
  private checkInterval: ReturnType<typeof setInterval> | undefined;
  private readonly checkIntervalMs: number;
  private readonly maxSessionAgeMs: number;

  constructor(
    initialState: StorageState,
    private readonly options: SessionHealthMonitorOptions
  ) {
    this.storageState = initialState;
    this.sessionCreatedAt = Date.now();
    this.checkIntervalMs = options.checkIntervalMs ?? 5 * 60 * 1_000;
    this.maxSessionAgeMs = options.maxSessionAgeMs ?? 45 * 60 * 1_000;
  }

  /** Get the current valid storage state. */
  getStorageState(): StorageState {
    return this.storageState;
  }

  /** Get the current health state for UI display. */
  getHealthState(): SessionHealthState {
    return {
      status: this.status,
      lastCheckedAt: new Date().toISOString(),
      sessionAgeMs: Date.now() - this.sessionCreatedAt,
      refreshCount: this.refreshCount
    };
  }

  /** Start periodic health checks. */
  start(): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      void this.checkAndRefresh();
    }, this.checkIntervalMs);
    this.options.logger.info("Session health monitor started", {
      checkIntervalMs: this.checkIntervalMs,
      maxSessionAgeMs: this.maxSessionAgeMs
    });
  }

  /** Stop periodic health checks. */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Check session health and refresh if needed.
   * Call this between accounts for proactive recovery.
   */
  async checkAndRefresh(): Promise<StorageState> {
    const ageMs = Date.now() - this.sessionCreatedAt;

    // Proactive refresh if session is approaching max age
    if (ageMs > this.maxSessionAgeMs) {
      this.options.logger.info("Session approaching max age, proactively refreshing", {
        ageMs,
        maxSessionAgeMs: this.maxSessionAgeMs
      });
      return this.refresh();
    }

    // Verify session is still valid
    const isValid = await this.verifySession();
    if (!isValid) {
      this.options.logger.warn("Session health check failed, refreshing");
      this.status = "expired";
      return this.refresh();
    }

    this.status = ageMs > this.maxSessionAgeMs * 0.8 ? "degraded" : "healthy";
    return this.storageState;
  }

  /** Force a session refresh regardless of health. */
  async refresh(): Promise<StorageState> {
    this.status = "recovering";
    this.options.logger.info("Refreshing master session...");

    try {
      this.storageState = await getMasterStorageState({
        browser: this.options.browser,
        config: this.options.config,
        logger: this.options.logger,
        storageStatePath: this.options.storageStatePath
      });
      this.sessionCreatedAt = Date.now();
      this.refreshCount += 1;
      this.status = "healthy";
      this.options.logger.info("Session refreshed successfully", { refreshCount: this.refreshCount });
      return this.storageState;
    } catch (error) {
      this.status = "expired";
      const msg = error instanceof Error ? error.message : String(error);
      this.options.logger.error("Session refresh failed", { error: msg });
      throw error;
    }
  }

  private async verifySession(): Promise<boolean> {
    const context = await this.options.browser.newContext({
      storageState: this.storageState
    });

    try {
      const page = await context.newPage();
      const baseUrl = this.options.config.webBaseUrl.replace(/\/$/, "");
      const response = await page.goto(`${baseUrl}/profile`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000
      });

      // If we got redirected to sign-in, session is expired
      if (page.url().includes("/signin") || page.url().includes("/login")) {
        return false;
      }

      // If we got a non-200 response, session may be degraded
      if (response && !response.ok()) {
        return false;
      }

      return true;
    } catch {
      return false;
    } finally {
      await context.close();
    }
  }
}
