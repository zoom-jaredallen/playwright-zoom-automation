import { AddZcxAdminMichaelChenFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "add-zcx-admin-michael-chen",
  name: "Add ZCX Admin Michael Chen",
  description: "Recorded workflow: 1 navigation(s), 1 field fill(s), 7 click(s), 0 assertion(s), 0 screenshot(s).",
  enabled: true,
  category: "custom",
  createFlow(context) {
    return new AddZcxAdminMichaelChenFlow(context);
  }
};

export default plugin;
