import dotenv from "dotenv";
import { loadAddressProfile, type AddressProfile } from "./addressProfiles.js";
import { parseEnvWithSchema, type ParsedEnv } from "./configSchema.js";
import type { SecretProvider } from "./server/credentials/types.js";
import { CONFIG_SECRET_KEYS, resolveSecretReferences } from "./server/credentials/credentialResolver.js";

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
    masterStorageStatePath?: string;
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
  /**
   * Per-account parameter values, keyed by sub-account id, then parameter name.
   * Lets a single workflow push distinct data (e.g. a different user) to each
   * account. Injected at job time; takes precedence over the address profile.
   */
  accountValues?: Record<string, Record<string, string>>;
}

/**
 * Load and validate configuration from environment variables.
 * Uses Zod schema for validation with clear, actionable error messages.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = parseEnvWithSchema(env);

  const profile = parsed.ADDRESS_PROFILE
    ? loadAddressProfile(parsed.ADDRESS_PROFILES_PATH, parsed.ADDRESS_PROFILE)
    : undefined;

  // Validate that address fields are available (from profile or env)
  if (!profile) {
    const missingAddress: string[] = [];
    if (!parsed.BUSINESS_ADDRESS_LINE1) missingAddress.push("BUSINESS_ADDRESS_LINE1");
    if (!parsed.BUSINESS_ADDRESS_CITY) missingAddress.push("BUSINESS_ADDRESS_CITY");
    if (!parsed.BUSINESS_ADDRESS_POSTAL_CODE) missingAddress.push("BUSINESS_ADDRESS_POSTAL_CODE");
    if (!parsed.BUSINESS_ADDRESS_COUNTRY) missingAddress.push("BUSINESS_ADDRESS_COUNTRY");
    if (!parsed.BUSINESS_ADDRESS_CUSTOMER_NAME) missingAddress.push("BUSINESS_ADDRESS_CUSTOMER_NAME");
    if (!parsed.DOCUMENT_ID_PATH && !parsed.DOCUMENT_BUSINESS_VERIFICATION_PATH) {
      missingAddress.push("DOCUMENT_ID_PATH", "DOCUMENT_BUSINESS_VERIFICATION_PATH");
    }
    if (missingAddress.length > 0) {
      throw new Error(`Missing required environment variables: ${missingAddress.join(", ")}`);
    }
  }

  const address = resolveAddressConfig(parsed, profile);
  const documents = resolveDocumentConfig(parsed, profile);

  return {
    zoom: buildZoomConfig(parsed),
    address,
    documents,
    runtime: buildRuntimeConfig(parsed)
  };
}

export function loadConfigFromEnvFile(envPath = ".env"): AppConfig {
  dotenv.config({ path: envPath });
  return loadConfig(process.env);
}

export async function loadConfigWithSecrets(
  env: NodeJS.ProcessEnv,
  provider: Pick<SecretProvider, "getSecret">
): Promise<AppConfig> {
  const resolved = await resolveSecretReferences(env, provider, [...CONFIG_SECRET_KEYS]);
  return loadConfig(resolved);
}

// --- Internal builders ---

function buildZoomConfig(parsed: ParsedEnv): AppConfig["zoom"] {
  const hasS2S = Boolean(
    parsed.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID &&
    parsed.ZOOM_SERVER_TO_SERVER_CLIENT_ID &&
    parsed.ZOOM_SERVER_TO_SERVER_CLIENT_SECRET
  );

  return {
    adminEmail: parsed.ZOOM_ADMIN_EMAIL,
    adminPassword: parsed.ZOOM_ADMIN_PASSWORD,
    webBaseUrl: parsed.ZOOM_WEB_BASE_URL,
    apiBaseUrl: parsed.ZOOM_API_BASE_URL,
    apiAccessToken: parsed.ZOOM_API_ACCESS_TOKEN,
    serverToServer: hasS2S
      ? {
          accountId: parsed.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID!,
          clientId: parsed.ZOOM_SERVER_TO_SERVER_CLIENT_ID!,
          clientSecret: parsed.ZOOM_SERVER_TO_SERVER_CLIENT_SECRET!
        }
      : undefined
  };
}

function buildRuntimeConfig(parsed: ParsedEnv): AppConfig["runtime"] {
  const ownerRange = parsed.SUB_ACCOUNT_OWNER_FROM && parsed.SUB_ACCOUNT_OWNER_TO
    ? { from: parsed.SUB_ACCOUNT_OWNER_FROM, to: parsed.SUB_ACCOUNT_OWNER_TO }
    : undefined;

  return {
    headless: parsed.HEADLESS,
    dryRun: parsed.DRY_RUN,
    progressPath: parsed.PROGRESS_PATH,
    artifactsDir: parsed.ARTIFACTS_DIR,
    masterStorageStatePath: parsed.ZOOM_MASTER_STORAGE_STATE_PATH,
    accountLimit: parsed.SUB_ACCOUNT_LIMIT,
    accountIds: parsed.SUB_ACCOUNT_IDS,
    ownerRange,
    flowRetryAttempts: parsed.FLOW_RETRY_ATTEMPTS,
    flowRetryBaseDelayMs: parsed.FLOW_RETRY_BASE_DELAY_MS,
    accountDelayMs: parsed.ACCOUNT_DELAY_MS,
    concurrency: parsed.CONCURRENCY
  };
}

function resolveAddressConfig(parsed: ParsedEnv, profile: AddressProfile | undefined): AppConfig["address"] {
  const customerName =
    parsed.BUSINESS_ADDRESS_CUSTOMER_NAME ??
    profile?.customerName ??
    "";

  return {
    line1: parsed.BUSINESS_ADDRESS_LINE1 ?? profile?.address.line1 ?? "",
    line2: parsed.BUSINESS_ADDRESS_LINE2 ?? profile?.address.line2,
    city: parsed.BUSINESS_ADDRESS_CITY ?? profile?.address.city ?? "",
    state: parsed.BUSINESS_ADDRESS_STATE ?? profile?.address.state,
    postalCode: parsed.BUSINESS_ADDRESS_POSTAL_CODE ?? profile?.address.postalCode ?? "",
    country: parsed.BUSINESS_ADDRESS_COUNTRY ?? profile?.country ?? "",
    customerName,
    numberType: parsed.BUSINESS_ADDRESS_NUMBER_TYPE ?? profile?.numberType ?? "Toll",
    contactName: parsed.BUSINESS_ADDRESS_CONTACT_NAME ?? profile?.contact?.name ?? customerName,
    contactNumber: parsed.BUSINESS_ADDRESS_CONTACT_NUMBER ?? profile?.contact?.number,
    contactEmail:
      parsed.BUSINESS_ADDRESS_CONTACT_EMAIL ??
      profile?.contact?.email ??
      parsed.ZOOM_ADMIN_EMAIL
  };
}

function resolveDocumentConfig(parsed: ParsedEnv, profile: AddressProfile | undefined): AppConfig["documents"] {
  return {
    required: profile?.documents?.required ?? true,
    idPath: parsed.DOCUMENT_ID_PATH ?? profile?.documents?.idPath,
    businessVerificationPath:
      parsed.DOCUMENT_BUSINESS_VERIFICATION_PATH ?? profile?.documents?.businessVerificationPath
  };
}
