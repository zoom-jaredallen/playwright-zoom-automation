import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "./server/credentials/secretRedactor.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  /** Minimum log level to emit. Defaults to "info". */
  level?: LogLevel;
  /** Path to a JSONL log file. If set, all logs are appended here. */
  filePath?: string;
  /** Base metadata merged into every log entry. */
  baseMeta?: Record<string, unknown>;
  /** Whether to suppress console output (useful for tests). */
  silent?: boolean;
  /** Literal secret values to redact from log messages and metadata. */
  redactValues?: Array<string | undefined>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? "info";
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];
  const filePath = options.filePath;
  const baseMeta = options.baseMeta ?? {};
  const silent = options.silent ?? false;
  const redactValues = options.redactValues ?? [];

  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < minPriority) {
      return;
    }

    const entry = redactSecrets({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseMeta,
      ...meta
    }, redactValues);
    const line = JSON.stringify(entry);

    if (!silent) {
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    if (filePath) {
      try {
        appendFileSync(filePath, `${line}\n`, "utf8");
      } catch {
        // Swallow file write errors to avoid crashing the automation
      }
    }
  }

  function child(childMeta: Record<string, unknown>): Logger {
    return createLogger({
      level: minLevel,
      filePath,
      baseMeta: { ...baseMeta, ...childMeta },
      silent,
      redactValues
    });
  }

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child
  };
}

/**
 * Resolve the LOG_LEVEL env var to a valid LogLevel.
 */
export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized && normalized in LOG_LEVEL_PRIORITY) {
    return normalized as LogLevel;
  }
  return "info";
}

/**
 * Default console logger for backward compatibility.
 * Use `createLogger()` for production runs with file output.
 */
export const consoleLogger: Logger = createLogger();
