import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedWebhookUrl, WebhookService } from "../src/server/services/webhooks.js";

const originalAllowPrivate = process.env.ALLOW_PRIVATE_WEBHOOK_URLS;

afterEach(() => {
  if (originalAllowPrivate === undefined) {
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  } else {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = originalAllowPrivate;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isAllowedWebhookUrl", () => {
  it("rejects non-https and private webhook targets", async () => {
    await expect(isAllowedWebhookUrl("http://example.com/hook")).resolves.toBe(false);
    await expect(isAllowedWebhookUrl("https://localhost/hook")).resolves.toBe(false);
    await expect(isAllowedWebhookUrl("https://127.0.0.1/hook")).resolves.toBe(false);
    await expect(isAllowedWebhookUrl("https://10.1.2.3/hook")).resolves.toBe(false);
    await expect(isAllowedWebhookUrl("https://[::1]/hook")).resolves.toBe(false);
  });

  it("allows private webhook targets only when explicitly enabled", async () => {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = "true";

    await expect(isAllowedWebhookUrl("https://127.0.0.1/hook")).resolves.toBe(true);
  });
});

describe("WebhookService", () => {
  it("does not follow webhook redirects", async () => {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = "true";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://127.0.0.1/internal" }
    })));
    const service = new WebhookService([
      {
        id: "wh_test",
        name: "Test",
        url: "https://example.com/hook",
        events: ["job.completed"],
        enabled: true,
        maxRetries: 0
      }
    ]);

    await service.dispatch("job.completed", { jobId: "job-1" });

    expect(service.getDeliveryLog()).toEqual([
      expect.objectContaining({
        webhookId: "wh_test",
        status: "failed",
        responseStatus: 302,
        error: "Redirects are not allowed for webhook deliveries"
      })
    ]);
  });
});
