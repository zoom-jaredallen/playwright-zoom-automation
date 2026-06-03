import { describe, expect, it } from "vitest";
import { TokenManager } from "../src/zoom/oauth.js";
import type { AppConfig } from "../src/config.js";

function createMockConfig(overrides?: Partial<AppConfig["zoom"]>): AppConfig["zoom"] {
  return {
    adminEmail: "admin@example.com",
    adminPassword: "password",
    webBaseUrl: "https://zoom.us",
    apiBaseUrl: "https://api.zoom.us/v2",
    serverToServer: {
      accountId: "test-account",
      clientId: "test-client",
      clientSecret: "test-secret"
    },
    ...overrides
  };
}

describe("TokenManager", () => {
  it("returns a static token when apiAccessToken is configured", async () => {
    const config = createMockConfig({ apiAccessToken: "static-token-123" });
    const manager = new TokenManager(config);

    const token = await manager.getAccessToken();
    expect(token).toBe("static-token-123");
  });

  it("fetches a token from the OAuth endpoint on first call", async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const config = createMockConfig();
    const manager = new TokenManager(config, { fetchImpl: mockFetch as unknown as typeof fetch });

    const token = await manager.getAccessToken();
    expect(token).toBe("fresh-token");
    expect(fetchCount).toBe(1);
  });

  it("caches the token and does not re-fetch within the TTL", async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ access_token: `token-${fetchCount}`, expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const config = createMockConfig();
    const manager = new TokenManager(config, { fetchImpl: mockFetch as unknown as typeof fetch });

    const token1 = await manager.getAccessToken();
    const token2 = await manager.getAccessToken();
    const token3 = await manager.getAccessToken();

    expect(token1).toBe("token-1");
    expect(token2).toBe("token-1");
    expect(token3).toBe("token-1");
    expect(fetchCount).toBe(1);
  });

  it("refreshes the token when it is within the refresh margin of expiry", async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ access_token: `token-${fetchCount}`, expires_in: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const config = createMockConfig();
    // Set refresh margin to 2000ms so a 1-second token is always "expired"
    const manager = new TokenManager(config, {
      fetchImpl: mockFetch as unknown as typeof fetch,
      refreshMarginMs: 2_000
    });

    const token1 = await manager.getAccessToken();
    const token2 = await manager.getAccessToken();

    expect(token1).toBe("token-1");
    expect(token2).toBe("token-2");
    expect(fetchCount).toBe(2);
  });

  it("deduplicates concurrent refresh requests", async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify({ access_token: `token-${fetchCount}`, expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const config = createMockConfig();
    const manager = new TokenManager(config, { fetchImpl: mockFetch as unknown as typeof fetch });

    const [token1, token2, token3] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken()
    ]);

    expect(token1).toBe("token-1");
    expect(token2).toBe("token-1");
    expect(token3).toBe("token-1");
    expect(fetchCount).toBe(1);
  });
});
