import type { AutomationFlow } from "../automation/types.js";
import type { Logger } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { Browser } from "playwright";
import type { StorageState } from "../zoom/auth.js";
import type { WorkflowCategory } from "@zoom-automation/workflow-core";

/**
 * A workflow plugin definition. Each workflow module exports this shape.
 */
export interface WorkflowPlugin {
  /** Unique workflow identifier (used in URLs and config). */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Short description of what this workflow does. */
  description: string;
  /** Whether this workflow is ready for use. */
  enabled: boolean;
  /** Category for UI grouping. */
  category: WorkflowCategory;
  /** Factory function that creates the AutomationFlow instance. */
  createFlow(context: WorkflowContext): AutomationFlow;
}

/**
 * Context passed to the workflow factory when creating a flow instance.
 */
export interface WorkflowContext {
  browser: Browser;
  masterStorageState: StorageState;
  config: AppConfig;
  logger: Logger;
}
