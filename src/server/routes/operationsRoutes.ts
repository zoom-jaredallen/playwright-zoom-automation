import type express from "express";
import { isAllowedWebhookUrl, WebhookService } from "../services/webhooks.js";
import { computeDashboardMetrics } from "../services/analytics.js";
import { computeOperationsMetrics } from "../operations/runMetricsService.js";
import { createFileAuditStore } from "../audit/auditStore.js";
import { createFileJobStore } from "../services/fileJobStore.js";
import { createFileWorkItemStore } from "../queues/fileWorkItemStore.js";
import { createFileWorkerRegistry } from "../workers/fileWorkerRegistry.js";
import { createSchedulerStore } from "../services/scheduler.js";

export interface OperationsRoutesContext {
  auditStore: ReturnType<typeof createFileAuditStore>;
  jobStore: ReturnType<typeof createFileJobStore>;
  schedulerStore: ReturnType<typeof createSchedulerStore>;
  webhookService: WebhookService;
  workerRegistry: ReturnType<typeof createFileWorkerRegistry>;
  workItemStore: ReturnType<typeof createFileWorkItemStore>;
}

export function registerOperationsRoutes(app: express.Express, context: OperationsRoutesContext): void {
  app.get("/api/dashboard", (_request, response) => {
    const jobs = context.jobStore.listJobs();
    const metrics = computeDashboardMetrics(jobs);
    response.json(metrics);
  });

  app.get("/api/operations", (_request, response) => {
    response.json({
      metrics: computeOperationsMetrics({
        jobs: context.jobStore.listJobs(),
        workItems: context.workItemStore.listWorkItems(),
        workers: context.workerRegistry.list()
      })
    });
  });

  app.get("/api/audit", (request, response) => {
    response.json({
      events: context.auditStore.list({
        jobId: typeof request.query.jobId === "string" ? request.query.jobId : undefined,
        workflowId: typeof request.query.workflowId === "string" ? request.query.workflowId : undefined
      })
    });
  });

  app.get("/api/webhooks", (_request, response) => {
    response.json({ webhooks: context.webhookService.listWebhooks() });
  });

  app.get("/api/webhooks/deliveries", (_request, response) => {
    response.json({ deliveries: context.webhookService.getDeliveryLog() });
  });

  app.post("/api/webhooks", async (request, response, next) => {
    const body = request.body;
    if (!body.name || !body.url || !body.events) {
      response.status(400).json({ error: "name, url, and events are required" });
      return;
    }
    try {
      if (!(await isAllowedWebhookUrl(body.url))) {
        response.status(400).json({ error: "Webhook URL must use https: and resolve to a public host" });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
    const config = {
      id: `wh_${Date.now().toString(36)}`,
      name: body.name,
      url: body.url,
      events: body.events,
      enabled: body.enabled ?? true,
      secret: body.secret,
      maxRetries: body.maxRetries ?? 3,
      headers: body.headers
    };
    context.webhookService.addWebhook(config);
    response.status(201).json({ webhook: config });
  });

  app.delete("/api/webhooks/:id", (request, response) => {
    context.webhookService.removeWebhook(request.params.id);
    response.json({ ok: true });
  });

  app.get("/api/system/health", (_request, response) => {
    response.json({
      status: "ok",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      schedules: context.schedulerStore.list().filter((s) => s.enabled).length,
      activeJobs: context.jobStore.listJobs().filter((j) => j.status === "running").length
    });
  });
}
