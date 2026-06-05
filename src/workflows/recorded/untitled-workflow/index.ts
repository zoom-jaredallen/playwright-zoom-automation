import { UntitledWorkflowFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "untitled-workflow",
  name: "Add ZCX Admin",
  description: "Recorded workflow: 1 navigation(s), 1 field fill(s), 6 click(s), 0 assertion(s), 0 screenshot(s).",
  enabled: true,
  category: "phone",
  createFlow(context) {
    return new UntitledWorkflowFlow(context);
  }
};

export default plugin;
