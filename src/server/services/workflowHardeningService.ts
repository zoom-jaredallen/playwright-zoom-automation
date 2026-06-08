import {
  calculateQualityReport,
  createZoomAdminAdapter,
  hardenRecordedWorkflow,
  type RecordedWorkflow
} from "@zoom-automation/workflow-core";

export function applyAutomaticWorkflowHardening(workflow: RecordedWorkflow): RecordedWorkflow {
  const source = cloneWorkflow(workflow);
  const hardened = hardenRecordedWorkflow({
    actions: source.actions,
    assertions: source.assertions,
    adapter: createZoomAdminAdapter()
  });

  return {
    ...source,
    actions: hardened.actions,
    assertions: hardened.assertions,
    quality: calculateQualityReport(hardened.actions, hardened.assertions),
    hardening: hardened.report
  };
}

function cloneWorkflow(workflow: RecordedWorkflow): RecordedWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as RecordedWorkflow;
}
