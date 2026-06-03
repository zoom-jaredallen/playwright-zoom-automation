import { retry } from "../automation/retry.js";
import type { SubAccount } from "../automation/types.js";
import type { TokenManager } from "./oauth.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type TokenProvider = string | TokenManager;

export interface ZoomApiClientOptions {
  accessToken: TokenProvider;
  baseUrl: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  pageSize?: number;
}

interface ZoomAccountsResponse {
  accounts?: Array<{
    id?: string;
    account_id?: string;
    account_name?: string;
    name?: string;
    owner_email?: string;
    account_owner_email?: string;
    email?: string;
    owner_name?: string;
    account_owner_name?: string;
  }>;
  next_page_token?: string;
}

export class ZoomApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ZoomApiError";
  }
}

export class ZoomApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly pageSize: number;

  constructor(private readonly options: ZoomApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pageSize = options.pageSize ?? 300;
  }

  async listSubAccounts(): Promise<SubAccount[]> {
    const accounts: SubAccount[] = [];
    let nextPageToken: string | undefined;

    do {
      const url = new URL(`${this.options.baseUrl.replace(/\/$/, "")}/accounts`);
      url.searchParams.set("page_size", String(this.pageSize));
      if (nextPageToken) {
        url.searchParams.set("next_page_token", nextPageToken);
      }

      const body = await this.getJson<ZoomAccountsResponse>(url.toString());
      for (const account of body.accounts ?? []) {
        const id = account.id ?? account.account_id;
        if (!id) {
          continue;
        }
        const subAccount: SubAccount = {
          id,
          name: account.account_name ?? account.name ?? id
        };
        const ownerEmail = account.owner_email ?? account.account_owner_email ?? account.email;
        const ownerName = account.owner_name ?? account.account_owner_name;
        if (ownerEmail) {
          subAccount.ownerEmail = ownerEmail;
        }
        if (ownerName) {
          subAccount.ownerName = ownerName;
        }
        accounts.push(subAccount);
      }
      nextPageToken = body.next_page_token || undefined;
    } while (nextPageToken);

    return accounts;
  }

  private async resolveToken(): Promise<string> {
    const provider = this.options.accessToken;
    if (typeof provider === "string") {
      return provider;
    }
    return provider.getAccessToken();
  }

  private async getJson<T>(url: string): Promise<T> {
    return retry(
      async () => {
        const token = await this.resolveToken();
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          throw await this.toError(response);
        }

        return (await response.json()) as T;
      },
      {
        attempts: 4,
        baseDelayMs: 1_000,
        sleep: this.options.sleep
      }
    );
  }

  private async toError(response: Response): Promise<ZoomApiError> {
    const text = await response.text();
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) * 1_000 : undefined;
    const retryable = response.status === 429 || response.status >= 500;
    return new ZoomApiError(
      `Zoom API request failed with status ${response.status}: ${text}`,
      response.status,
      retryable,
      retryAfterMs
    );
  }
}
