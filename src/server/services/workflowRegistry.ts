import type { AutomationFlow } from "../../automation/types.js";
import { createPluginWorkflowRegistry, type WorkflowContext, type WorkflowDefinition, type WorkflowRegistry } from "../../workflows/index.js";
import {
  createRecordedFlowLazy,
  getRecordedDefinition,
  listRecordedDefinitions,
  recordedWorkflowExists
} from "./recordedWorkflowLoader.js";

export type { WorkflowDefinition, WorkflowRegistry } from "../../workflows/index.js";

/**
 * Create the workflow registry. Built-in plugins come from the plugin directory;
 * recorded workflows (compiled under src/workflows/recorded/*) are discovered
 * dynamically so duplicated/edited workflows are runnable without a code change.
 * Built-ins take precedence on id collisions.
 */
export function createWorkflowRegistry(): WorkflowRegistry {
  const builtins = createPluginWorkflowRegistry();
  const builtinIds = new Set(builtins.list().map((definition) => definition.id));

  return {
    list(): WorkflowDefinition[] {
      const recorded = listRecordedDefinitions().filter((definition) => !builtinIds.has(definition.id));
      return [...builtins.list(), ...recorded];
    },

    getEnabled(id: string): WorkflowDefinition {
      if (builtinIds.has(id)) {
        return builtins.getEnabled(id);
      }
      const recorded = getRecordedDefinition(id);
      if (!recorded) {
        throw new Error(`Workflow not found: ${id}`);
      }
      return recorded;
    },

    createFlow(id: string, context: WorkflowContext): AutomationFlow {
      if (builtinIds.has(id)) {
        return builtins.createFlow(id, context);
      }
      if (!recordedWorkflowExists(id)) {
        throw new Error(`Workflow not found: ${id}`);
      }
      return createRecordedFlowLazy(id, context);
    }
  };
}
