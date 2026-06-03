/**
 * Webhook Notification Service — sends notifications to external services
 * when automation events occur (job completed, failed, cancelled).
 */
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

        const response = await fetch(config.url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000)
        });

        delivery.responseStatus = response.status;

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
