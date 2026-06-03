import { BusinessAddressFlow } from "../zoom/businessAddressFlow.js";
import type { WorkflowPlugin } from "./types.js";

const plugin: WorkflowPlugin = {
  id: "add-business-address",
  name: "Add business address",
  description: "Add a configured business address and required documents for Zoom Phone numbers.",
  enabled: true,
  category: "phone",
  createFlow(context) {
    return new BusinessAddressFlow(context);
  }
};

export default plugin;
