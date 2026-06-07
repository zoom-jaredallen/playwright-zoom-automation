/**
 * Discovers compiled recorded workflows under src/workflows/recorded/* and makes
 * them runnable. Recorded flows are loaded lazily via dynamic import at run time
 * (the server runs under tsx in every mode), with an mtime cache-bust so edits
 * take effect without a server restart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AutomationFlow, FlowInput, FlowResult } from "../../automation/types.js";
import type { WorkflowContext, WorkflowDefinition } from "../../workflows/index.js";
import type { WorkflowCategory, WorkflowParameter } from "@zoom-automation/workflow-core";

const RECORDED_BASE = path.resolve("src/workflows/recorded");

class RecordedPathError extends Error {}

/** Resolve a path inside the recorded directory, rejecting traversal outside it. */
function resolveRecorded(id: string, ...segments: string[]): string {
  const resolved = path.resolve(RECORDED_BASE, id, ...segments);
  if (!resolved.startsWith(RECORDED_BASE + path.sep)) {
    throw new RecordedPathError(`Invalid recorded workflow id: "${id}"`);
  }
  return resolved;
}

/** List every compiled recorded workflow as a runnable WorkflowDefinition. */
export function listRecordedDefinitions(): WorkflowDefinition[] {
  let entries: string[];
  try {
    entries = readdirSync(RECORDED_BASE);
  } catch {
    return [];
  }

  const definitions: WorkflowDefinition[] = [];
  for (const id of entries) {
    try {
      if (!statSync(path.join(RECORDED_BASE, id)).isDirectory()) continue;
      const schema = JSON.parse(readFileSync(path.join(RECORDED_BASE, id, "schema.json"), "utf8")) as {
        meta?: { name?: string; description?: string; category?: WorkflowCategory };
        parameters?: WorkflowParameter[];
      };
      definitions.push({
        id,
        name: schema.meta?.name || id,
        description: schema.meta?.description ?? "Recorded workflow",
        enabled: true,
        category: schema.meta?.category ?? "custom",
        parameters: schema.parameters ?? []
      });
    } catch {
      // Skip directories without a readable schema.json.
    }
  }
  return definitions;
}

export function recordedWorkflowExists(id: string): boolean {
  try {
    return statSync(resolveRecorded(id, "schema.json")).isFile();
  } catch {
    return false;
  }
}

export function getRecordedDefinition(id: string): WorkflowDefinition | undefined {
  return listRecordedDefinitions().find((definition) => definition.id === id);
}

type RecordedFlowModule = { default: new (context: WorkflowContext) => AutomationFlow };

/**
 * Return a thin AutomationFlow that dynamically imports the compiled recorded
 * flow on first run. Keeps the registry's createFlow synchronous; the import is
 * deferred into run(). The mtime query busts the ESM cache so saved edits run
 * without restarting the server.
 */
export function createRecordedFlowLazy(id: string, context: WorkflowContext): AutomationFlow {
  return {
    name: id,
    async run(input: FlowInput): Promise<FlowResult> {
      const flowPath = resolveRecorded(id, "flow.ts");
      const version = statSync(flowPath).mtimeMs;
      const url = `${pathToFileURL(flowPath).href}?v=${version}`;
      const mod = (await import(url)) as RecordedFlowModule;
      const flow = new mod.default(context);
      return flow.run(input);
    }
  };
}
