import { z } from "zod";

// --- Custom Zod transforms for env var parsing ---

/** Trim and treat empty strings as undefined. */
const envString = z.string().transform((val) => {
  const trimmed = val.trim();
  return trimmed || undefined;
}).optional();

/** Required non-empty trimmed string. */
const requiredEnvString = z.string().min(1, "must not be empty").transform((val) => val.trim());

/** Boolean from env var (supports true/false/1/0/yes/no/y/n). */
function envBoolean(defaultValue: boolean) {
  return z.string().optional().transform((val) => {
    const normalized = val?.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
    throw new Error(`Invalid boolean value: "${val}"`);
  });
}

/** Positive integer from env var. */
function envPositiveInt(defaultValue: number) {
  return z.string().optional().transform((val) => {
    const trimmed = val?.trim();
    if (!trimmed) return defaultValue;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== trimmed) {
      throw new Error(`must be a positive integer, got "${val}"`);
    }
    return parsed;
  });
}

/** Non-negative integer from env var. */
function envNonNegativeInt(defaultValue: number) {
  return z.string().optional().transform((val) => {
    const trimmed = val?.trim();
    if (!trimmed) return defaultValue;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
      throw new Error(`must be zero or a positive integer, got "${val}"`);
    }
    return parsed;
  });
}

/** Optional positive integer (returns undefined if not set). */
function envOptionalPositiveInt() {
  return z.string().optional().transform((val) => {
    const trimmed = val?.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== trimmed) {
      throw new Error(`must be a positive integer, got "${val}"`);
    }
    return parsed;
  });
}

/** Comma-separated list of strings. */
const envCsvList = z.string().optional().transform((val) => {
  const values = val?.split(",").map((item) => item.trim()).filter(Boolean);
  return values && values.length > 0 ? values : undefined;
});

// --- Environment schema ---

export const envSchema = z.object({
  // Zoom credentials
  ZOOM_ADMIN_EMAIL: requiredEnvString,
  ZOOM_ADMIN_PASSWORD: requiredEnvString,

  // API auth (one of these must be provided)
  ZOOM_API_ACCESS_TOKEN: envString,
  ZOOM_SERVER_TO_SERVER_ACCOUNT_ID: envString,
  ZOOM_SERVER_TO_SERVER_CLIENT_ID: envString,
  ZOOM_SERVER_TO_SERVER_CLIENT_SECRET: envString,

  // Base URLs
  ZOOM_WEB_BASE_URL: z.string().optional().transform((val) => val?.trim() || "https://zoom.us"),
  ZOOM_API_BASE_URL: z.string().optional().transform((val) => val?.trim() || "https://api.zoom.us/v2"),

  // Address profile
  ADDRESS_PROFILE: envString,
  ADDRESS_PROFILES_PATH: z.string().optional().transform((val) => val?.trim() || "addresses.yaml"),

  // Legacy address fields
  BUSINESS_ADDRESS_LINE1: envString,
  BUSINESS_ADDRESS_LINE2: envString,
  BUSINESS_ADDRESS_CITY: envString,
  BUSINESS_ADDRESS_STATE: envString,
  BUSINESS_ADDRESS_POSTAL_CODE: envString,
  BUSINESS_ADDRESS_COUNTRY: envString,
  BUSINESS_ADDRESS_CUSTOMER_NAME: envString,
  BUSINESS_ADDRESS_NUMBER_TYPE: envString,
  BUSINESS_ADDRESS_CONTACT_NAME: envString,
  BUSINESS_ADDRESS_CONTACT_NUMBER: envString,
  BUSINESS_ADDRESS_CONTACT_EMAIL: envString,

  // Documents
  DOCUMENT_ID_PATH: envString,
  DOCUMENT_BUSINESS_VERIFICATION_PATH: envString,

  // Runtime controls
  HEADLESS: envBoolean(true),
  DRY_RUN: envBoolean(false),
  PROGRESS_PATH: z.string().optional().transform((val) => val?.trim() || "output/progress.json"),
  ARTIFACTS_DIR: z.string().optional().transform((val) => val?.trim() || "output/artifacts"),
  SUB_ACCOUNT_LIMIT: envOptionalPositiveInt(),
  SUB_ACCOUNT_IDS: envCsvList,
  SUB_ACCOUNT_OWNER_FROM: envString,
  SUB_ACCOUNT_OWNER_TO: envString,
  FLOW_RETRY_ATTEMPTS: envPositiveInt(2),
  FLOW_RETRY_BASE_DELAY_MS: envNonNegativeInt(5_000),
  ACCOUNT_DELAY_MS: envNonNegativeInt(0),
  CONCURRENCY: envPositiveInt(1)
}).superRefine((data, ctx) => {
  // Validate API auth: need either access token or complete S2S credentials
  const hasToken = Boolean(data.ZOOM_API_ACCESS_TOKEN);
  const hasS2S = Boolean(
    data.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID &&
    data.ZOOM_SERVER_TO_SERVER_CLIENT_ID &&
    data.ZOOM_SERVER_TO_SERVER_CLIENT_SECRET
  );

  if (!hasToken && !hasS2S) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either ZOOM_API_ACCESS_TOKEN or all three ZOOM_SERVER_TO_SERVER_* variables must be set",
      path: ["ZOOM_API_ACCESS_TOKEN"]
    });
  }

  // Validate owner range: both or neither
  if (data.SUB_ACCOUNT_OWNER_FROM && !data.SUB_ACCOUNT_OWNER_TO) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must be configured together",
      path: ["SUB_ACCOUNT_OWNER_TO"]
    });
  }
  if (data.SUB_ACCOUNT_OWNER_TO && !data.SUB_ACCOUNT_OWNER_FROM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must be configured together",
      path: ["SUB_ACCOUNT_OWNER_FROM"]
    });
  }
});

export type ParsedEnv = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables using the Zod schema.
 * Returns a typed, transformed result or throws with clear error messages.
 */
export function parseEnvWithSchema(env: NodeJS.ProcessEnv): ParsedEnv {
  // Zod expects all keys to exist (even as undefined), so we pass the full env
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  ${path}: ${issue.message}`;
    });
    throw new Error(`Configuration validation failed:\n${issues.join("\n")}`);
  }

  return result.data;
}
