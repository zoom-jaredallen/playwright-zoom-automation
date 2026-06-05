import { AddZcxAdminMichaelChenV2Flow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "add-zcx-admin-michael-chen-v2",
  name: "Add ZCX Admin Michael Chen V2",
  description: "Recorded workflow: 1 navigation(s), 1 field fill(s), 7 click(s), 0 assertion(s), 0 screenshot(s).",
  enabled: true,
  category: "custom",
  createFlow(context) {
    return new AddZcxAdminMichaelChenV2Flow(context);
  }
};

export default plugin;
