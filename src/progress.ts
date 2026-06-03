import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunSummary, SubAccount } from "./automation/types.js";

export interface AccountResult {
  accountId: string;
  accountName: string;
  status: "completed" | "skipped" | "failed";
  message?: string;
  error?: string;
  durationMs?: number;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: RunSummary;
  accounts: AccountResult[];
}

/**
 * CLI progress tracker that displays real-time progress to the terminal.
 * Uses simple line output (no cursor manipulation) for compatibility with
 * piped output and CI environments.
 */
export class CliProgress {
  private total = 0;
  private processed = 0;
  private completed = 0;
  private skipped = 0;
  private failed = 0;
  private startTime = Date.now();
  private readonly isTTY: boolean;
  private readonly results: AccountResult[] = [];
  private accountStartTimes = new Map<string, number>();

  constructor(totalAccounts: number) {
    this.total = totalAccounts;
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  onAccountStart(account: SubAccount): void {
    this.accountStartTimes.set(account.id, Date.now());
    this.printProgress(`▶ [${this.processed + 1}/${this.total}] Processing ${account.name}...`);
  }

  onAccountCompleted(account: SubAccount, message?: string): void {
    this.processed += 1;
    this.completed += 1;
    const duration = this.getAccountDuration(account.id);
    this.results.push({
      accountId: account.id,
      accountName: account.name,
      status: "completed",
      message,
      durationMs: duration
    });
    this.printProgress(`  ✓ ${account.name} — completed${message ? ` (${message})` : ""}${this.formatDuration(duration)}`);
  }

  onAccountSkipped(account: SubAccount, message?: string): void {
    this.processed += 1;
    this.skipped += 1;
    const duration = this.getAccountDuration(account.id);
    this.results.push({
      accountId: account.id,
      accountName: account.name,
      status: "skipped",
      message,
      durationMs: duration
    });
    this.printProgress(`  ○ ${account.name} — skipped${message ? ` (${message})` : ""}${this.formatDuration(duration)}`);
  }

  onAccountFailed(account: SubAccount, error: Error): void {
    this.processed += 1;
    this.failed += 1;
    const duration = this.getAccountDuration(account.id);
    this.results.push({
      accountId: account.id,
      accountName: account.name,
      status: "failed",
      error: error.message,
      durationMs: duration
    });
    this.printProgress(`  ✗ ${account.name} — FAILED: ${error.message}${this.formatDuration(duration)}`);
  }

  onProgressSkipped(account: SubAccount): void {
    this.processed += 1;
    this.skipped += 1;
    this.results.push({
      accountId: account.id,
      accountName: account.name,
      status: "skipped",
      message: "Already completed in previous run"
    });
  }

  /**
   * Print the final summary to the console.
   */
  printSummary(): void {
    const totalDuration = Date.now() - this.startTime;
    const lines = [
      "",
      "═══════════════════════════════════════════════════",
      "  Run Summary",
      "═══════════════════════════════════════════════════",
      `  Total accounts:  ${this.total}`,
      `  Completed:       ${this.completed}`,
      `  Skipped:         ${this.skipped}`,
      `  Failed:          ${this.failed}`,
      `  Duration:        ${this.formatTotalDuration(totalDuration)}`,
      "═══════════════════════════════════════════════════"
    ];

    if (this.failed > 0) {
      lines.push("");
      lines.push("  Failed accounts:");
      for (const result of this.results.filter((r) => r.status === "failed")) {
        lines.push(`    • ${result.accountName}: ${result.error}`);
      }
    }

    lines.push("");
    console.log(lines.join("\n"));
  }

  /**
   * Generate and save a JSON run report to disk.
   */
  saveReport(artifactsDir: string, runId: string): string {
    const report: RunReport = {
      runId,
      startedAt: new Date(this.startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - this.startTime,
      summary: {
        completed: this.completed,
        skipped: this.skipped,
        failed: this.failed
      },
      accounts: this.results
    };

    const reportsDir = path.join(artifactsDir, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, `${runId}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return reportPath;
  }

  private getAccountDuration(accountId: string): number | undefined {
    const startTime = this.accountStartTimes.get(accountId);
    if (!startTime) return undefined;
    this.accountStartTimes.delete(accountId);
    return Date.now() - startTime;
  }

  private formatDuration(ms: number | undefined): string {
    if (ms === undefined) return "";
    if (ms < 1000) return ` [${ms}ms]`;
    return ` [${(ms / 1000).toFixed(1)}s]`;
  }

  private formatTotalDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private printProgress(line: string): void {
    if (this.isTTY) {
      const percent = this.total > 0 ? Math.round((this.processed / this.total) * 100) : 0;
      const bar = this.renderBar(percent);
      console.log(`${bar} ${line}`);
    } else {
      console.log(line);
    }
  }

  private renderBar(percent: number): string {
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}] ${String(percent).padStart(3)}%`;
  }
}
