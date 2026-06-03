import dotenv from "dotenv";
import { loadAddressProfile, type AddressProfile } from "./addressProfiles.js";

export interface AppConfig {
  zoom: {
    adminEmail: string;
    adminPassword: string;
    webBaseUrl: string;
    apiBaseUrl: string;
    apiAccessToken?: string;
    serverToServer?: {
      accountId: string;
      clientId: string;
      clientSecret: string;
    };
  };
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    customerName: string;
    numberType: string;
    contactName: string;
    contactNumber?: string;
    contactEmail: string;
  };
  documents: {
    required: boolean;
    idPath?: string;
    businessVerificationPath?: string;
  };
  runtime: {
    headless: boolean;
    dryRun: boolean;
    progressPath: string;
    artifactsDir: string;
    accountLimit?: number;
    accountIds?: string[];
    ownerRange?: {
      from: string;
      to: string;
    };
    flowRetryAttempts: number;
    flowRetryBaseDelayMs: number;
    accountDelayMs: number;
    concurrency: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const profileName = optional(env.ADDRESS_PROFILE);
  const profile = profileName
    ? loadAddressProfile(optional(env.ADDRESS_PROFILES_PATH) ?? "addresses.yaml", profileName)
    : undefined;
  const missing = required(env, ["ZOOM_ADMIN_EMAIL", "ZOOM_ADMIN_PASSWORD"]);

  if (!profile) {
    missing.push(
      ...required(env, [
        "BUSINESS_ADDRESS_LINE1",
        "BUSINESS_ADDRESS_CITY",
        "BUSINESS_ADDRESS_POSTAL_CODE",
        "BUSINESS_ADDRESS_COUNTRY",
        "BUSINESS_ADDRESS_CUSTOMER_NAME",
        "DOCUMENT_ID_PATH",
        "DOCUMENT_BUSINESS_VERIFICATION_PATH"
      ])
    );
  }

  const apiAccessToken = optional(env.ZOOM_API_ACCESS_TOKEN);
  const serverToServerAccountId = optional(env.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID);
  const serverToServerClientId = optional(env.ZOOM_SERVER_TO_SERVER_CLIENT_ID);
  const serverToServerClientSecret = optional(env.ZOOM_SERVER_TO_SERVER_CLIENT_SECRET);
  const hasCompleteServerToServerCredentials = Boolean(
    serverToServerAccountId && serverToServerClientId && serverToServerClientSecret
  );

  if (!apiAccessToken && !hasCompleteServerToServerCredentials) {
    missing.push(
      "ZOOM_API_ACCESS_TOKEN or ZOOM_SERVER_TO_SERVER_ACCOUNT_ID/ZOOM_SERVER_TO_SERVER_CLIENT_ID/ZOOM_SERVER_TO_SERVER_CLIENT_SECRET"
    );
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const accountLimit = parseOptionalPositiveInteger(env.SUB_ACCOUNT_LIMIT, "SUB_ACCOUNT_LIMIT");
  const accountIds = parseCsv(env.SUB_ACCOUNT_IDS);
  const ownerRange = parseOwnerRange(env);
  const flowRetryAttempts = parseOptionalPositiveInteger(env.FLOW_RETRY_ATTEMPTS, "FLOW_RETRY_ATTEMPTS") ?? 2;
  const flowRetryBaseDelayMs =
    parseOptionalNonNegativeInteger(env.FLOW_RETRY_BASE_DELAY_MS, "FLOW_RETRY_BASE_DELAY_MS") ?? 5_000;
  const accountDelayMs = parseOptionalNonNegativeInteger(env.ACCOUNT_DELAY_MS, "ACCOUNT_DELAY_MS") ?? 0;
  const concurrency = parseOptionalPositiveInteger(env.CONCURRENCY, "CONCURRENCY") ?? 1;
  const address = resolveAddressConfig(env, profile);
  const documents = resolveDocumentConfig(env, profile);

  return {
    zoom: {
      adminEmail: requireValue(env.ZOOM_ADMIN_EMAIL, "ZOOM_ADMIN_EMAIL"),
      adminPassword: requireValue(env.ZOOM_ADMIN_PASSWORD, "ZOOM_ADMIN_PASSWORD"),
      webBaseUrl: optional(env.ZOOM_WEB_BASE_URL) ?? "https://zoom.us",
      apiBaseUrl: optional(env.ZOOM_API_BASE_URL) ?? "https://api.zoom.us/v2",
      apiAccessToken,
      serverToServer: hasCompleteServerToServerCredentials
        ? {
            accountId: serverToServerAccountId!,
            clientId: serverToServerClientId!,
            clientSecret: serverToServerClientSecret!
          }
        : undefined
    },
    address,
    documents,
    runtime: {
      headless: parseBoolean(env.HEADLESS, true),
      dryRun: parseBoolean(env.DRY_RUN, false),
      progressPath: optional(env.PROGRESS_PATH) ?? "output/progress.json",
      artifactsDir: optional(env.ARTIFACTS_DIR) ?? "output/artifacts",
      accountLimit,
      accountIds,
      ownerRange,
      flowRetryAttempts,
      flowRetryBaseDelayMs,
      accountDelayMs,
      concurrency
    }
  };
}

function resolveAddressConfig(env: NodeJS.ProcessEnv, profile: AddressProfile | undefined): AppConfig["address"] {
  const customerName =
    optional(env.BUSINESS_ADDRESS_CUSTOMER_NAME) ??
    profile?.customerName ??
    requireValue(env.BUSINESS_ADDRESS_CUSTOMER_NAME, "BUSINESS_ADDRESS_CUSTOMER_NAME");

  return {
    line1:
      optional(env.BUSINESS_ADDRESS_LINE1) ??
      profile?.address.line1 ??
      requireValue(env.BUSINESS_ADDRESS_LINE1, "BUSINESS_ADDRESS_LINE1"),
    line2: optional(env.BUSINESS_ADDRESS_LINE2) ?? profile?.address.line2,
    city:
      optional(env.BUSINESS_ADDRESS_CITY) ??
      profile?.address.city ??
      requireValue(env.BUSINESS_ADDRESS_CITY, "BUSINESS_ADDRESS_CITY"),
    state: optional(env.BUSINESS_ADDRESS_STATE) ?? profile?.address.state,
    postalCode:
      optional(env.BUSINESS_ADDRESS_POSTAL_CODE) ??
      profile?.address.postalCode ??
      requireValue(env.BUSINESS_ADDRESS_POSTAL_CODE, "BUSINESS_ADDRESS_POSTAL_CODE"),
    country:
      optional(env.BUSINESS_ADDRESS_COUNTRY) ??
      profile?.country ??
      requireValue(env.BUSINESS_ADDRESS_COUNTRY, "BUSINESS_ADDRESS_COUNTRY"),
    customerName,
    numberType: optional(env.BUSINESS_ADDRESS_NUMBER_TYPE) ?? profile?.numberType ?? "Toll",
    contactName: optional(env.BUSINESS_ADDRESS_CONTACT_NAME) ?? profile?.contact?.name ?? customerName,
    contactNumber: optional(env.BUSINESS_ADDRESS_CONTACT_NUMBER) ?? profile?.contact?.number,
    contactEmail:
      optional(env.BUSINESS_ADDRESS_CONTACT_EMAIL) ??
      profile?.contact?.email ??
      requireValue(env.ZOOM_ADMIN_EMAIL, "ZOOM_ADMIN_EMAIL")
  };
}

function resolveDocumentConfig(env: NodeJS.ProcessEnv, profile: AddressProfile | undefined): AppConfig["documents"] {
  const idPath = optional(env.DOCUMENT_ID_PATH) ?? profile?.documents?.idPath;
  const businessVerificationPath =
    optional(env.DOCUMENT_BUSINESS_VERIFICATION_PATH) ?? profile?.documents?.businessVerificationPath;

  return {
    required: profile?.documents?.required ?? true,
    idPath,
    businessVerificationPath
  };
}

export function loadConfigFromEnvFile(envPath = ".env"): AppConfig {
  dotenv.config({ path: envPath });
  return loadConfig(process.env);
}

function required(env: NodeJS.ProcessEnv, keys: string[]): string[] {
  return keys.filter((key) => !optional(env[key]));
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = optional(value);
  if (!normalized) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = optional(value)?.toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  const normalized = optional(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== normalized) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  const normalized = optional(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== normalized) {
    throw new Error(`${name} must be zero or a positive integer`);
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] | undefined {
  const values = optional(value)
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

function parseOwnerRange(env: NodeJS.ProcessEnv): { from: string; to: string } | undefined {
  const from = optional(env.SUB_ACCOUNT_OWNER_FROM);
  const to = optional(env.SUB_ACCOUNT_OWNER_TO);
  if (!from && !to) {
    return undefined;
  }
  if (!from || !to) {
    throw new Error("SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must be configured together");
  }

  return { from, to };
}
