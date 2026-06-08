import { AddZoomPhoneSydneyNumbersFlow } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "add-zoom-phone-sydney-numbers",
  name: "Add Zoom Phone Sydney Numbers",
  description: "Adds 4 available Zoom Phone numbers for Sydney, Australia, selecting the first available results dynamically.",
  enabled: true,
  category: "phone",
  createFlow(context) {
    return new AddZoomPhoneSydneyNumbersFlow(context);
  }
};

export default plugin;
