import { AddAuContactCenterBusinessAddressFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "add-au-contact-center-business-address",
  name: "Add AU Contact Center Business Address",
  description: "Adds the Australian Contact Center Virtual Service business address and saves the request.",
  enabled: true,
  category: "phone",
  createFlow(context) {
    return new AddAuContactCenterBusinessAddressFlow(context);
  }
};

export default plugin;
