import type { AppConfig } from "../config.js";
import { retry } from "../automation/retry.js";

interface ZoomOAuthTokenResult {
  token: string;
  expiresInMs: number;
}

export async function resolveZoomApiAccessToken(
  config: AppConfig["zoom"],
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (config.apiAccessToken) {
    return config.apiAccessToken;
  }

  if (!config.serverToServer) {
    throw new Error("Zoom API credentials are not configured");
  }

  const result = await fetchServerToServerToken(config, fetchImpl);
  return result.token;
}

async function fetchServerToServerToken(
  config: AppConfig["zoom"],
  fetchImpl: typeof fetch
): Promise<ZoomOAuthTokenResult> {
  const credentials = Buffer.from(
    `${config.serverToServer!.clientId}:${config.serverToServer!.clientSecret}`,
    "utf8"
  ).toString("base64");
  const tokenUrl = new URL(`${config.webBaseUrl.replace(/\/$/, "")}/oauth/token`);
  tokenUrl.searchParams.set("grant_type", "account_credentials");
  tokenUrl.searchParams.set("account_id", config.serverToServer!.accountId);

  const body = await retry(
    async () => {
      const response = await fetchImpl(tokenUrl.toString(), {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        const error = new Error(`Zoom OAuth token request failed with status ${response.status}`);
        Object.assign(error, { retryable: response.status === 429 || response.status >= 500 });
        throw error;
      }

      return (await response.json()) as { access_token?: string; expires_in?: number };
    },
    { attempts: 3, baseDelayMs: 1_000 }
  );

  if (!body.access_token) {
    throw new Error("Zoom OAuth token response did not include access_token");
  }

  return {
    token: body.access_token,
    // Default to 55 minutes if expires_in is absent (Zoom typically returns 3600s)
    expiresInMs: (body.expires_in ?? 3_300) * 1_000
  };
}

/**
 * A token manager that caches the access token and automatically refreshes
 * it when it is within `refreshMarginMs` of expiry. Use this for long-running
 * automation sessions where the token may expire mid-run.
 */
export class TokenManager {
  private token: string | undefined;
  private expiresAt = 0;
  private refreshPromise: Promise<string> | undefined;
  private readonly refreshMarginMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: AppConfig["zoom"],
    options?: { refreshMarginMs?: number; fetchImpl?: typeof fetch }
  ) {
    this.refreshMarginMs = options?.refreshMarginMs ?? 5 * 60 * 1_000; // 5 minutes
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async getAccessToken(): Promise<string> {
    if (this.config.apiAccessToken) {
      return this.config.apiAccessToken;
    }

    if (this.token && Date.now() < this.expiresAt - this.refreshMarginMs) {
      return this.token;
    }

    // Deduplicate concurrent refresh requests
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh();
    }

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refresh(): Promise<string> {
    if (!this.config.serverToServer) {
      throw new Error("Zoom API credentials are not configured");
    }

    const result = await fetchServerToServerToken(this.config, this.fetchImpl);
    this.token = result.token;
    this.expiresAt = Date.now() + result.expiresInMs;
    return this.token;
  }
}
