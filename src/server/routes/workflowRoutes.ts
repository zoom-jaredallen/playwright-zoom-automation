import type express from "express";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { safeParseWorkflow } from "@zoom-automation/workflow-core";
import { listAddressProfiles } from "../../addressProfiles.js";
import { compileWorkflow, slugify } from "../../compiler/compiler.js";
import type { RecordedWorkflow } from "../../compiler/types.js";
import { loadConfig } from "../../config.js";
import type { SubAccount } from "../../automation/types.js";
import { createFileWorkflowLifecycleStore, type WorkflowLifecycleStatus } from "../governance/workflowLifecycle.js";
import { createFileAuditStore } from "../audit/auditStore.js";
import { createWorkflowRegistry } from "../services/workflowRegistry.js";
import { collectWorkflowParameters } from "../services/workflowParameterService.js";
import { evaluateRunReadiness } from "../services/runReadinessService.js";
import { applyAutomaticWorkflowHardening } from "../services/workflowHardeningService.js";
import { createBulkPreflightPlan, type BulkPreflightEvidence } from "../services/preflightService.js";

export interface WorkflowRoutesContext {
  lifecycleStore: ReturnType<typeof createFileWorkflowLifecycleStore>;
  auditStore: ReturnType<typeof createFileAuditStore>;
  workflowRegistry: ReturnType<typeof createWorkflowRegistry>;
}

export function registerWorkflowRoutes(app: express.Express, context: WorkflowRoutesContext): void {
  const { lifecycleStore, auditStore, workflowRegistry } = context;

  app.get("/api/workflows", (_request, response) => {
    response.json({ workflows: workflowRegistry.list() });
  });

  app.get("/api/workflows/recorded", (_request, response) => {
    const recordedDir = path.resolve("src/workflows/recorded");
    try {
      const entries = readdirSync(recordedDir).filter((entry) => {
        try { return statSync(path.join(recordedDir, entry)).isDirectory(); } catch { return false; }
      });
      const workflows = entries.map((id) => {
        try {
          const schema = JSON.parse(readFileSync(path.join(recordedDir, id, "schema.json"), "utf8"));
          return {
            id,
            name: schema.meta?.name ?? id,
            category: schema.meta?.category ?? "custom",
            actionCount: schema.actions?.length ?? 0,
            lifecycleStatus: lifecycleStore.getOrCreate(id, "recorded").status
          };
        } catch {
          return { id, name: id, category: "custom", actionCount: 0, lifecycleStatus: lifecycleStore.getOrCreate(id, "recorded").status };
        }
      });
      response.json({ workflows });
    } catch {
      response.json({ workflows: [] });
    }
  });

  app.get("/api/workflows/recorded/:id", (request, response) => {
    try {
      const schemaPath = resolveRecordedWorkflowPath(request.params.id, "schema.json");
      const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
      response.json({ workflow: schema });
    } catch (error) {
      if (error instanceof PathTraversalError) {
        response.status(400).json({ error: error.message });
      } else {
        response.status(404).json({ error: "Recorded workflow not found" });
      }
    }
  });

  app.put("/api/workflows/recorded/:id", (request, response, next) => {
    try {
      const workflow = request.body?.workflow;
      if (!workflow) {
        response.status(400).json({ error: "workflow is required in request body" });
        return;
      }
      const validation = safeParseWorkflow(workflow);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }
      const lifecycle = lifecycleStore.getOrCreate(request.params.id, "recorded");
      if (lifecycle.status === "published") {
        response.status(409).json({ error: "Published workflows are immutable. Duplicate the workflow before editing." });
        return;
      }
      resolveRecordedWorkflowPath(request.params.id);
      const result = compileWorkflow(applyAutomaticWorkflowHardening(workflow), path.resolve("src/workflows/recorded"), request.params.id);
      lifecycleStore.getOrCreate(result.id, "recorded");
      auditStore.append({ eventType: "workflow_imported", actor: "web-ui", workflowId: result.id, message: "Recorded workflow saved" });
      response.json({ ok: true, compiled: result.id });
    } catch (error) {
      if (error instanceof PathTraversalError) {
        response.status(400).json({ error: (error as Error).message });
      } else {
        next(error);
      }
    }
  });

  app.post("/api/workflows/recorded/:id/duplicate", (request, response, next) => {
    try {
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      if (!name) {
        response.status(400).json({ error: "name is required" });
        return;
      }

      let source: unknown;
      try {
        source = JSON.parse(readFileSync(resolveRecordedWorkflowPath(request.params.id, "schema.json"), "utf8"));
      } catch (error) {
        if (error instanceof PathTraversalError) {
          response.status(400).json({ error: error.message });
        } else {
          response.status(404).json({ error: "Recorded workflow not found" });
        }
        return;
      }

      const candidate = {
        ...(source as Record<string, unknown>),
        meta: { ...((source as { meta?: Record<string, unknown> }).meta ?? {}), name, recordedAt: new Date().toISOString() }
      };
      const validation = safeParseWorkflow(candidate);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }

      const uniqueId = uniqueRecordedId(name);
      const result = compileWorkflow(applyAutomaticWorkflowHardening(validation.workflow), path.resolve("src/workflows/recorded"), uniqueId);
      lifecycleStore.getOrCreate(result.id, "recorded");
      auditStore.append({ eventType: "workflow_imported", actor: "web-ui", workflowId: result.id, message: "Recorded workflow duplicated" });
      response.status(201).json({ id: result.id, name });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workflows/import", (request, response, next) => {
    try {
      const body = request.body as { workflow?: RecordedWorkflow; options?: { compile?: boolean; enableImmediately?: boolean } };
      const validation = safeParseWorkflow(body.workflow);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }

      const workflow = applyAutomaticWorkflowHardening(validation.workflow);
      if (!workflow.meta.name) {
        response.status(400).json({ error: "Workflow must have a name" });
        return;
      }

      const outputBase = path.resolve("src/workflows/recorded");
      const result = compileWorkflow(workflow, outputBase);
      lifecycleStore.getOrCreate(result.id, "recorded");
      auditStore.append({ eventType: "workflow_imported", actor: "web-ui", workflowId: result.id, message: "Recorded workflow imported" });

      response.status(201).json({
        id: result.id,
        outputDir: result.outputDir,
        warnings: result.warnings,
        testResults: result.testResults,
        message: `Workflow "${workflow.meta.name}" compiled to ${result.outputDir}. Add it to src/workflows/index.ts to enable.`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/address-profiles", (_request, response) => {
    const config = loadConfig(process.env);
    const profilesPath = process.env.ADDRESS_PROFILES_PATH ?? "addresses.yaml";
    const profiles = listAddressProfiles(profilesPath).map(({ id, profile }) => ({
      id,
      country: profile.country,
      numberType: profile.numberType ?? "Toll",
      customerName: profile.customerName,
      address: profile.address,
      documentsRequired: profile.documents?.required ?? true
    }));
    response.json({
      selectedProfile: process.env.ADDRESS_PROFILE ?? "australia_sydney",
      adminEmail: config.zoom.adminEmail,
      profiles
    });
  });

  app.post("/api/workflows/:id/lifecycle", (request, response) => {
    const status = request.body?.status as WorkflowLifecycleStatus | undefined;
    if (!status) {
      response.status(400).json({ error: "status is required" });
      return;
    }
    try {
      const current = lifecycleStore.getOrCreate(request.params.id, "recorded");
      if (current.status === status) {
        response.json({ lifecycle: current });
        return;
      }
      const lifecycle = lifecycleStore.transition(request.params.id, status, {
        actor: typeof request.body?.actor === "string" ? request.body.actor : "web-ui",
        note: typeof request.body?.note === "string" ? request.body.note : undefined
      });
      auditStore.append({
        eventType: status === "published" ? "workflow_published" : status === "approved" ? "workflow_approved" : "workflow_validated",
        actor: typeof request.body?.actor === "string" ? request.body.actor : "web-ui",
        workflowId: request.params.id,
        message: `Workflow moved to ${status}`
      });
      response.json({ lifecycle });
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/readiness/check", (request, response, next) => {
    try {
      const body = request.body as {
        accounts?: SubAccount[];
        workflowIds?: string[];
        addressProfile?: string;
        dryRun?: boolean;
        parameterValues?: Record<string, string>;
      };
      const config = loadConfig({ ...process.env, ADDRESS_PROFILE: body.addressProfile ?? process.env.ADDRESS_PROFILE });
      const enabledWorkflowIds = new Set(workflowRegistry.list().filter((workflow) => workflow.enabled).map((workflow) => workflow.id));
      const workflows = workflowRegistry.list();
      const selectedWorkflowParameters = collectWorkflowParameters(
        workflows.filter((workflow) => (body.workflowIds ?? []).includes(workflow.id))
      );
      const result = evaluateRunReadiness({
        selectedAccounts: body.accounts ?? [],
        workflowIds: body.workflowIds ?? [],
        enabledWorkflowIds,
        workflows,
        addressProfile: body.addressProfile,
        dryRun: body.dryRun ?? true,
        requiredDocuments: [
          { label: "ID document", path: config.documents.idPath, required: config.documents.required },
          { label: "Business verification", path: config.documents.businessVerificationPath, required: config.documents.required }
        ],
        parameters: selectedWorkflowParameters,
        parameterValues: body.parameterValues ?? {}
      });
      response.json({ readiness: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/preflight/simulate", (request, response) => {
    const body = request.body as {
      accounts?: SubAccount[];
      workflows?: unknown[];
      accountEvidence?: Record<string, BulkPreflightEvidence>;
    };
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    const rawWorkflows = Array.isArray(body.workflows) ? body.workflows : [];
    if (accounts.length === 0) {
      response.status(400).json({ error: "accounts are required" });
      return;
    }
    if (rawWorkflows.length === 0) {
      response.status(400).json({ error: "workflows are required" });
      return;
    }

    const workflows: Array<{ id: string; workflow: RecordedWorkflow }> = [];
    for (const rawWorkflow of rawWorkflows) {
      const validation = safeParseWorkflow(rawWorkflow);
      if (!validation.success) {
        response.status(400).json({ error: validation.error });
        return;
      }
      workflows.push({
        id: slugify(validation.workflow.meta.name),
        workflow: validation.workflow
      });
    }

    response.json({
      preflight: createBulkPreflightPlan({
        workflows,
        accounts,
        accountEvidence: body.accountEvidence
      })
    });
  });
}

class PathTraversalError extends Error {}

const RECORDED_WORKFLOW_BASE = path.resolve("src/workflows/recorded");

function uniqueRecordedId(name: string): string {
  const base = slugify(name) || `recorded-${Date.now()}`;
  let candidate = base;
  let counter = 2;
  while (statSyncExists(path.join(RECORDED_WORKFLOW_BASE, candidate))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function statSyncExists(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveRecordedWorkflowPath(id: string, ...segments: string[]): string {
  const resolved = path.resolve(RECORDED_WORKFLOW_BASE, id, ...segments);
  if (!resolved.startsWith(RECORDED_WORKFLOW_BASE + path.sep) && resolved !== RECORDED_WORKFLOW_BASE) {
    throw new PathTraversalError(`Invalid workflow id: "${id}"`);
  }
  return resolved;
}
