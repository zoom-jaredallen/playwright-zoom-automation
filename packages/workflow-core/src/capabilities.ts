/**
 * Capability flags gating which workflow-editor features a surface exposes.
 * The Chrome extension can do everything (it has a live tab + content script);
 * the Web UI can inspect and edit but cannot record or run live browser checks.
 */
export interface WorkflowEditorCapabilities {
  /** Capture new steps from a live page. Extension only. */
  canRecord: boolean;
  /** Replay steps in a real browser tab before a bulk run. Extension only. */
  canRunBrowserPreflight: boolean;
  /** Validate/highlight a selector against the live page. Extension only. */
  canTestSelectorOnPage: boolean;
  /** Edit, add, delete steps. */
  canEditSteps: boolean;
  /** Reorder steps. */
  canReorder: boolean;
  /** Edit selector strategies (CSS override, notes). */
  canEditSelectors: boolean;
  /** Edit per-step timeout/retry/onFailure policy. */
  canEditPolicies: boolean;
  /** Edit conditional step guards. */
  canEditConditions: boolean;
  /** Confirm/dismiss detected parameters. */
  canManageParameters: boolean;
  /** Import/export/sync workflow JSON. */
  canImportExport: boolean;
}

export const EXTENSION_CAPABILITIES: WorkflowEditorCapabilities = {
  canRecord: true,
  canRunBrowserPreflight: true,
  canTestSelectorOnPage: true,
  canEditSteps: true,
  canReorder: true,
  canEditSelectors: true,
  canEditPolicies: true,
  canEditConditions: true,
  canManageParameters: true,
  canImportExport: true
};

export const WEB_UI_CAPABILITIES: WorkflowEditorCapabilities = {
  canRecord: false,
  canRunBrowserPreflight: false,
  canTestSelectorOnPage: false,
  canEditSteps: true,
  canReorder: true,
  canEditSelectors: true,
  canEditPolicies: true,
  canEditConditions: true,
  canManageParameters: true,
  canImportExport: true
};
