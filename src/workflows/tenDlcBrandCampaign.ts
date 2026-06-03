import type { AutomationFlow, FlowInput, FlowResult } from "../automation/types.js";
import type { WorkflowPlugin } from "./types.js";

class TenDlcBrandCampaignFlow implements AutomationFlow {
  readonly name = "10dlc-brand-campaign";

  async run(_input: FlowInput): Promise<FlowResult> {
    throw new Error("10DLC brand and campaign workflow is not yet implemented");
  }
}

const plugin: WorkflowPlugin = {
  id: "10dlc-brand-campaign",
  name: "Add 10DLC campaign and brand",
  description: "Create or update 10DLC brand and campaign registration details.",
  enabled: false,
  category: "compliance",
  createFlow() {
    return new TenDlcBrandCampaignFlow();
  }
};

export default plugin;
