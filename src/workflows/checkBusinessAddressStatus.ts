import { BusinessAddressStatusFlow } from "../zoom/businessAddressStatusFlow.js";
import type { WorkflowPlugin } from "./types.js";

const plugin: WorkflowPlugin = {
  id: "check-business-address-status",
  name: "Check business address status",
  description: "Check whether the configured business address exists and report its verification status.",
  enabled: true,
  category: "phone",
  createFlow(context) {
    return new BusinessAddressStatusFlow(context);
  }
};

export default plugin;
