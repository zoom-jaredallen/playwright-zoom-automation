import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProgressAdapter, SubAccount } from "./types.js";

export type AccountStatus = "running" | "completed" | "skipped" | "failed";

export interface AccountProgress {
  id: string;
  name: string;
  status: AccountStatus;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  message?: string;
  retryable?: boolean;
}

export interface ProgressSnapshot {
  version: 1;
  accounts: Record<string, AccountProgress>;
}

export class ProgressStore implements ProgressAdapter {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ProgressSnapshot> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ProgressSnapshot;
      return {
        version: 1,
        accounts: parsed.accounts ?? {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, accounts: {} };
      }
      throw error;
    }
  }

  async shouldSkip(account: SubAccount): Promise<boolean> {
    const snapshot = await this.load();
    const status = snapshot.accounts[account.id]?.status;
    return status === "completed" || status === "skipped";
  }

  async markRunning(account: SubAccount): Promise<void> {
    await this.update(account, {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      failedAt: undefined,
      error: undefined,
      message: undefined,
      retryable: undefined
    });
  }

  async markCompleted(account: SubAccount, message?: string): Promise<void> {
    const existing = (await this.load()).accounts[account.id];
    await this.update(account, {
      status: "completed",
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      failedAt: undefined,
      error: undefined,
      message,
      retryable: undefined
    });
  }

  async markSkipped(account: SubAccount, message?: string): Promise<void> {
    const existing = (await this.load()).accounts[account.id];
    await this.update(account, {
      status: "skipped",
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      failedAt: undefined,
      error: undefined,
      message,
      retryable: undefined
    });
  }

  async markFailed(account: SubAccount, error: Error, retryable: boolean): Promise<void> {
    const existing = (await this.load()).accounts[account.id];
    await this.update(account, {
      status: "failed",
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      failedAt: new Date().toISOString(),
      error: error.message,
      message: undefined,
      retryable
    });
  }

  private async update(account: SubAccount, patch: Partial<AccountProgress>): Promise<void> {
    const snapshot = await this.load();
    snapshot.accounts[account.id] = {
      ...snapshot.accounts[account.id],
      id: account.id,
      name: account.name,
      ...patch
    };
    await this.save(snapshot);
  }

  private async save(snapshot: ProgressSnapshot): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}
