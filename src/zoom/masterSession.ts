import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { loginAsMasterAdmin, type StorageState } from "./auth.js";
import { MASTER_REQUIRED_COOKIES, validateCookies } from "./cookies.js";

export interface MasterSessionOptions {
  browser: Browser;
  config: AppConfig["zoom"];
  logger: Logger;
  storageStatePath?: string;
  timeoutMs?: number;
}

export async function getMasterStorageState(options: MasterSessionOptions): Promise<StorageState> {
  const storageStatePath = resolveMasterStorageStatePath(options);
  const cachedState = await readCachedStorageState(storageStatePath);

  if (cachedState) {
    const validation = await validateMasterStorageState({
      ...options,
      storageState: cachedState
    });

    if (validation.valid) {
      options.logger.info("Reusing cached Zoom master session", {
        storageStatePath: redactStorageStatePath(storageStatePath)
      });
      return cachedState;
    }

    options.logger.warn("Cached Zoom master session is not valid; logging in again", {
      reason: validation.reason,
      storageStatePath: redactStorageStatePath(storageStatePath)
    });
  }

  const freshState = await loginAsMasterAdmin(options);
  await writeCachedStorageState(storageStatePath, freshState);
  options.logger.info("Saved Zoom master session cache", {
    storageStatePath: redactStorageStatePath(storageStatePath)
  });
  return freshState;
}

export function resolveMasterStorageStatePath(options: Pick<MasterSessionOptions, "config" | "storageStatePath">): string {
  if (options.storageStatePath) {
    return path.resolve(options.storageStatePath);
  }

  const baseUrl = options.config.webBaseUrl.replace(/\/$/, "");
  const hash = createHash("sha256")
    .update(`${baseUrl}\n${options.config.adminEmail.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);

  return path.resolve("output/auth", `zoom-master-${hash}.storageState.json`);
}

async function readCachedStorageState(storageStatePath: string): Promise<StorageState | undefined> {
  try {
    return JSON.parse(await readFile(storageStatePath, "utf8")) as StorageState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

async function writeCachedStorageState(storageStatePath: string, storageState: StorageState): Promise<void> {
  await mkdir(path.dirname(storageStatePath), { recursive: true, mode: 0o700 });
  await writeFile(storageStatePath, `${JSON.stringify(storageState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function validateMasterStorageState(
  options: MasterSessionOptions & { storageState: StorageState }
): Promise<{ valid: true } | { valid: false; reason: string }> {
  const baseUrl = options.config.webBaseUrl.replace(/\/$/, "");
  const context = await options.browser.newContext({ storageState: options.storageState });

  try {
    await validateCookies(context, MASTER_REQUIRED_COOKIES, [baseUrl]);

    const page = await context.newPage();
    const response = await page.goto(`${baseUrl}/profile`, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 15_000
    });

    if (page.url().includes("/signin") || page.url().includes("/login")) {
      return { valid: false, reason: "cached session redirected to sign-in" };
    }

    if (response && !response.ok()) {
      return { valid: false, reason: `profile returned HTTP ${response.status()}` };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await context.close();
  }
}

function redactStorageStatePath(storageStatePath: string): string {
  return path.relative(process.cwd(), storageStatePath) || path.basename(storageStatePath);
}
