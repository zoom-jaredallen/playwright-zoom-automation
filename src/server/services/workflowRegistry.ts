import { createPluginWorkflowRegistry } from "../../workflows/index.js";

export type { WorkflowDefinition, WorkflowRegistry } from "../../workflows/index.js";

/**
 * Create the workflow registry from the plugin directory.
 * This is the single entry point used by the server.
 */
export function createWorkflowRegistry() {
  return createPluginWorkflowRegistry();
}
