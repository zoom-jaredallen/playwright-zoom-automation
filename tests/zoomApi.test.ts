import { describe, expect, it } from "vitest";
import { ZoomApiClient } from "../src/zoom/api.js";

describe("ZoomApiClient", () => {
  it("paginates sub accounts", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer token" });

      if (!url.includes("next_page_token=second")) {
        return jsonResponse({
          accounts: [{ id: "a1", account_name: "Account One", owner_email: "owner1@example.com" }],
          next_page_token: "second"
        });
      }

      return jsonResponse({
        accounts: [{ id: "a2", account_name: "Account Two", owner_name: "Owner Two" }],
        next_page_token: ""
      });
    };

    const client = new ZoomApiClient({
      accessToken: "token",
      baseUrl: "https://api.zoom.us/v2",
      fetchImpl
    });

    await expect(client.listSubAccounts()).resolves.toEqual([
      { id: "a1", name: "Account One", ownerEmail: "owner1@example.com" },
      { id: "a2", name: "Account Two", ownerName: "Owner Two" }
    ]);
    expect(requestedUrls[0]).toContain("page_size=300");
    expect(requestedUrls[1]).toContain("next_page_token=second");
  });

  it("retries rate-limited responses", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" }
        });
      }
      return jsonResponse({ accounts: [], next_page_token: "" });
    };

    const client = new ZoomApiClient({
      accessToken: "token",
      baseUrl: "https://api.zoom.us/v2",
      fetchImpl,
      sleep: async () => undefined
    });

    await expect(client.listSubAccounts()).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
