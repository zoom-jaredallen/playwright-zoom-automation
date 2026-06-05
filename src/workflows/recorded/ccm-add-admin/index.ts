import { CcmAddAdminFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "ccm-add-admin",
  name: "CCM Add Admin",
  description: "Recorded workflow: 1 navigation(s), 1 field fill(s), 7 click(s), 1 assertion(s), 0 screenshot(s).",
  enabled: true,
  category: "custom",
  createFlow(context) {
    return new CcmAddAdminFlow(context);
  }
};

export default plugin;
