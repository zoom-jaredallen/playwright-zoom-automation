/**
 * Parameter detection now lives in `@zoom-automation/workflow-core` so the Web UI
 * and extension detect parameters identically. Re-exported here to preserve the
 * existing `../shared/parameterizer.js` import path used by the content recorder.
 */
export { detectParameters } from "@zoom-automation/workflow-core";
export type { FieldContext } from "@zoom-automation/workflow-core";
