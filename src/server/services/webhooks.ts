/**
 * Webhook Notification Service — sends notifications to external services
 * when automation events occur (job completed, failed, cancelled).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AutomationJob } from "./inMemoryJobStore.js";

export type WebhookEvent = "job.completed" | "job.failed" | "job.cancelled" | "account.failed" | "schedule.triggered";

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  /** Optional secret for HMAC signature verification */
  secret?: string;
  /** Retry configuration */
  maxRetries: number;
  /** Headers to include in the request */
  headers?: Record<string, string>;
}

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: {
    jobId?: string;
    jobStatus?: string;
    workflowIds?: string[];
    summary?: { completed: number; skipped: number; failed: number };
    failedAccounts?: Array<{ accountId: string; error: string }>;
    message?: string;
  };
}

export interface WebhookDelivery {
  webhookId: string;
  event: WebhookEvent;
  timestamp: string;
  status: "success" | "failed" | "pending";
  responseStatus?: number;
  error?: string;
  attempts: number;
}

export class WebhookService {
  private configs: WebhookConfig[] = [];
  private deliveryLog: WebhookDelivery[] = [];
  private readonly maxLogSize = 100;

  constructor(initialConfigs?: WebhookConfig[]) {
    this.configs = initialConfigs ?? [];
  }

  /** Register a new webhook configuration. */
  addWebhook(config: WebhookConfig): void {
    this.configs.push(config);
  }

  /** Remove a webhook by ID. */
  removeWebhook(id: string): void {
    this.configs = this.configs.filter((c) => c.id !== id);
  }

  /** Get all webhook configurations. */
  listWebhooks(): WebhookConfig[] {
    return this.configs.map((c) => ({ ...c, secret: c.secret ? "***" : undefined }));
  }

  /** Get recent delivery log. */
  getDeliveryLog(): WebhookDelivery[] {
    return [...this.deliveryLog];
  }

  /** Dispatch an event to all matching webhooks. */
  async dispatch(event: WebhookEvent, data: WebhookPayload["data"]): Promise<void> {
    const matchingWebhooks = this.configs.filter(
      (config) => config.enabled && config.events.includes(event)
    );

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };

    await Promise.allSettled(
      matchingWebhooks.map((config) => this.deliver(config, payload))
    );
  }

  /** Dispatch job completion event. */
  async notifyJobComplete(job: AutomationJob): Promise<void> {
    const event: WebhookEvent = job.status === "failed" ? "job.failed"
      : job.status === "cancelled" ? "job.cancelled"
      : "job.completed";

    const failedAccounts = job.accounts
      .filter((a) => a.status === "failed")
      .map((a) => ({ accountId: a.accountId, error: a.error ?? "Unknown error" }));

    await this.dispatch(event, {
      jobId: job.id,
      jobStatus: job.status,
      workflowIds: job.input.workflowIds,
      summary: job.summary,
      failedAccounts: failedAccounts.length > 0 ? failedAccounts : undefined,
      message: job.events[job.events.length - 1]?.message
    });
  }

  private async deliver(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
    const delivery: WebhookDelivery = {
      webhookId: config.id,
      event: payload.event,
      timestamp: payload.timestamp,
      status: "pending",
      attempts: 0
    };

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      delivery.attempts = attempt;
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "ZoomAutomation/1.0",
          "X-Webhook-Event": payload.event,
          ...(config.headers ?? {})
        };

        if (config.secret) {
          const signature = await computeHmac(config.secret, JSON.stringify(payload));
          headers["X-Webhook-Signature"] = `sha256=${signature}`;
        }

        if (!(await isAllowedWebhookUrl(config.url))) {
          throw new Error("Webhook URL must use https: and resolve to a public host");
        }

        const response = await fetch(config.url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          redirect: "manual",
          signal: AbortSignal.timeout(10_000)
        });

        delivery.responseStatus = response.status;

        if (response.status >= 300 && response.status < 400) {
          delivery.status = "failed";
          delivery.error = "Redirects are not allowed for webhook deliveries";
          break;
        }

        if (response.ok) {
          delivery.status = "success";
          break;
        }

        if (response.status >= 500 && attempt <= config.maxRetries) {
          await sleep(1_000 * Math.pow(2, attempt - 1));
          continue;
        }

        delivery.status = "failed";
        delivery.error = `HTTP ${response.status}`;
        break;
      } catch (error) {
        delivery.error = error instanceof Error ? error.message : String(error);
        if (attempt > config.maxRetries) {
          delivery.status = "failed";
        } else {
          await sleep(1_000 * Math.pow(2, attempt - 1));
        }
      }
    }

    this.deliveryLog.push(delivery);
    if (this.deliveryLog.length > this.maxLogSize) {
      this.deliveryLog = this.deliveryLog.slice(-this.maxLogSize);
    }
  }
}

async function computeHmac(secret: string, payload: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// RFC-1918, loopback, link-local, multicast, and unique-local prefixes that
// must not receive webhook deliveries.
function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    return (
      /^0\./.test(normalized) ||
      /^10\./.test(normalized) ||
      /^127\./.test(normalized) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized) ||
      /^169\.254\./.test(normalized) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
      /^192\.168\./.test(normalized) ||
      /^198\.(1[89])\./.test(normalized) ||
      /^22[4-9]\./.test(normalized) ||
      /^23\d\./.test(normalized)
    );
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

/**
 * Return true only if the URL is syntactically valid https and the hostname
 * resolves to public addresses. Set ALLOW_PRIVATE_WEBHOOK_URLS=true for local
 * test targets.
 */
export async function isAllowedWebhookUrl(urlString: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }
  if (process.env.ALLOW_PRIVATE_WEBHOOK_URLS === "true") {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "localhost." ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".localhost.") ||
    hostname.endsWith(".internal")
  ) {
    return false;
  }

  if (isIP(hostname)) {
    return !isPrivateAddress(hostname);
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
