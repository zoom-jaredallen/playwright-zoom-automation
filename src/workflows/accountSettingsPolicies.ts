import type { AutomationFlow, FlowInput, FlowResult } from "../automation/types.js";
import type { WorkflowPlugin } from "./types.js";

class AccountSettingsPoliciesFlow implements AutomationFlow {
  readonly name = "account-settings-policies";

  async run(_input: FlowInput): Promise<FlowResult> {
    throw new Error("Account settings policies workflow is not yet implemented");
  }
}

const plugin: WorkflowPlugin = {
  id: "account-settings-policies",
  name: "Change account settings policies",
  description: "Apply a saved policy set across selected sub accounts.",
  enabled: false,
  category: "settings",
  createFlow() {
    return new AccountSettingsPoliciesFlow();
  }
};

export default plugin;
