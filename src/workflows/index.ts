import type { AutomationFlow } from "../automation/types.js";
import type { WorkflowCategory, WorkflowParameter } from "@zoom-automation/workflow-core";
import type { WorkflowLifecycleStatus } from "../server/governance/workflowLifecycle.js";
import type { WorkflowContext, WorkflowPlugin } from "./types.js";

// Static imports of all workflow plugins.
// To add a new workflow, create a file in this directory and add it here.
import addBusinessAddress from "./addBusinessAddress.js";
import checkBusinessAddressStatus from "./checkBusinessAddressStatus.js";
import accountSettingsPolicies from "./accountSettingsPolicies.js";
import tenDlcBrandCampaign from "./tenDlcBrandCampaign.js";

const allPlugins: WorkflowPlugin[] = [
  addBusinessAddress,
  checkBusinessAddressStatus,
  accountSettingsPolicies,
  tenDlcBrandCampaign
];

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: WorkflowCategory;
  parameters?: WorkflowParameter[];
  lifecycleStatus?: WorkflowLifecycleStatus;
}

export interface WorkflowRegistry {
  /** List all registered workflows. */
  list(): WorkflowDefinition[];
  /** Get an enabled workflow by ID. Throws if not found or disabled. */
  getEnabled(id: string): WorkflowDefinition;
  /** Create a flow instance for the given workflow ID. */
  createFlow(id: string, context: WorkflowContext): AutomationFlow;
}

/**
 * Create a workflow registry from all discovered plugins.
 */
export function createPluginWorkflowRegistry(): WorkflowRegistry {
  const pluginMap = new Map<string, WorkflowPlugin>();
  for (const plugin of allPlugins) {
    if (pluginMap.has(plugin.id)) {
      throw new Error(`Duplicate workflow plugin ID: ${plugin.id}`);
    }
    pluginMap.set(plugin.id, plugin);
  }

  return {
    list(): WorkflowDefinition[] {
      return allPlugins.map(({ id, name, description, enabled, category, parameters }) => ({
        id,
        name,
        description,
        enabled,
        category,
        parameters,
        lifecycleStatus: "published"
      }));
    },

    getEnabled(id: string): WorkflowDefinition {
      const plugin = pluginMap.get(id);
      if (!plugin) {
        throw new Error(`Workflow not found: ${id}`);
      }
      if (!plugin.enabled) {
        throw new Error(`Workflow is not enabled for this release: ${id}`);
      }
      return { id: plugin.id, name: plugin.name, description: plugin.description, enabled: plugin.enabled, category: plugin.category, parameters: plugin.parameters, lifecycleStatus: "published" };
    },

    createFlow(id: string, context: WorkflowContext): AutomationFlow {
      const plugin = pluginMap.get(id);
      if (!plugin) {
        throw new Error(`Workflow not found: ${id}`);
      }
      if (!plugin.enabled) {
        throw new Error(`Workflow is not enabled for this release: ${id}`);
      }
      return plugin.createFlow(context);
    }
  };
}

export type { WorkflowPlugin, WorkflowContext } from "./types.js";
