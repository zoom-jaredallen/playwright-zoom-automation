import { ZoomCxBusinessAddressAustraliaFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../workflows/types.js";

const plugin: WorkflowPlugin = {
  id: "zoom-cx-business-address-australia",
  name: "Zoom CX Business Address Australia",
  description: "Recorded workflow: 1 navigation(s), 0 field fill(s), 0 click(s).",
  enabled: true,
  category: "custom",
  createFlow(context) {
    return new ZoomCxBusinessAddressAustraliaFlow(context);
  }
};

export default plugin;
