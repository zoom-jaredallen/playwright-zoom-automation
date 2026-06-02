export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: "phone" | "settings" | "compliance";
}

export interface WorkflowRegistry {
  list(): WorkflowDefinition[];
  getEnabled(id: string): WorkflowDefinition;
}

const workflows: WorkflowDefinition[] = [
  {
    id: "add-business-address",
    name: "Add business address",
    description: "Add a configured business address and required documents for Zoom Phone numbers.",
    enabled: true,
    category: "phone"
  },
  {
    id: "check-business-address-status",
    name: "Check business address status",
    description: "Check whether the configured business address exists and report its verification status.",
    enabled: true,
    category: "phone"
  },
  {
    id: "account-settings-policies",
    name: "Change account settings policies",
    description: "Apply a saved policy set across selected sub accounts.",
    enabled: false,
    category: "settings"
  },
  {
    id: "10dlc-brand-campaign",
    name: "Add 10DLC campaign and brand",
    description: "Create or update 10DLC brand and campaign registration details.",
    enabled: false,
    category: "compliance"
  }
];

export function createWorkflowRegistry(): WorkflowRegistry {
  return {
    list: () => workflows.map((workflow) => ({ ...workflow })),
    getEnabled: (id: string) => {
      const workflow = workflows.find((item) => item.id === id);
      if (!workflow) {
        throw new Error(`Workflow not found: ${id}`);
      }
      if (!workflow.enabled) {
        throw new Error(`Workflow is not enabled for this release: ${id}`);
      }
      return { ...workflow };
    }
  };
}
