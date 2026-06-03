import { readdirSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import type { AutomationJob } from "./inMemoryJobStore.js";

export interface ArtifactView {
  name: string;
  type: "trace" | "screenshot" | "details" | "log" | "other";
  sizeBytes: number;
  modifiedAt: string;
  url: string;
  downloadUrl: string;
}

export function listJobArtifacts(options: {
  outputRoot: string;
  artifactsDir: string;
  job: AutomationJob;
  accountId?: string;
}): ArtifactView[] {
  const outputRoot = path.resolve(options.outputRoot);
  const artifactsDir = path.resolve(options.artifactsDir);
  const accountPrefixes = options.accountId
    ? [sanitizeArtifactToken(options.accountId)]
    : options.job.accounts.map((account) => sanitizeArtifactToken(account.accountId));
  const jobLogName = `job-${options.job.id}.jsonl`;
  const createdAtMs = new Date(options.job.createdAt).getTime();
  const updatedAtMs = new Date(options.job.updatedAt).getTime() + 5 * 60_000;

  const artifacts = [
    ...scanDirectory(outputRoot, artifactsDir, (_filePath, name, stat) => {
      if (name === jobLogName) return true;
      if (!accountPrefixes.some((prefix) => name.startsWith(prefix))) return false;
      const modifiedAtMs = stat.mtime.getTime();
      return Number.isNaN(createdAtMs) || (modifiedAtMs >= createdAtMs - 5 * 60_000 && modifiedAtMs <= updatedAtMs);
    })
  ];

  artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return artifacts;
}

function scanDirectory(
  outputRoot: string,
  directory: string,
  include: (filePath: string, name: string, stat: Stats) => boolean
): ArtifactView[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const artifacts: ArtifactView[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      artifacts.push(...scanDirectory(outputRoot, filePath, include));
      continue;
    }

    if (!include(filePath, entry, stat)) {
      continue;
    }

    const relativePath = path.relative(outputRoot, filePath).split(path.sep).map(encodeURIComponent).join("/");
    artifacts.push({
      name: entry,
      type: classifyArtifact(entry),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      url: `/artifacts/${relativePath}`,
      downloadUrl: `/artifacts/${relativePath}?download=1`
    });
  }
  return artifacts;
}

function classifyArtifact(name: string): ArtifactView["type"] {
  if (name.endsWith("-trace.zip") || name.endsWith("-dry-run-trace.zip")) return "trace";
  if (/\.(png|jpg|jpeg|webp)$/i.test(name)) return "screenshot";
  if (name.endsWith(".json")) return "details";
  if (name.endsWith(".jsonl") || name.endsWith(".log")) return "log";
  return "other";
}

function sanitizeArtifactToken(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, "_");
}
