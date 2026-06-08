import type { ExtensionMessage } from "../shared/types.js";

export function requiresEnabled(type: ExtensionMessage["type"]): boolean {
  return [
    "START_RECORDING",
    "PAUSE_RECORDING",
    "RESUME_RECORDING",
    "ACTION_RECORDED",
    "RUN_TEST_WORKFLOW",
    "RUN_TEST_ACTION",
    "WAIT_FOR_PAGE_READY",
    "EXECUTE_TEST_ACTION",
    "TEST_SELECTOR",
    "HIGHLIGHT_ACTION_TARGET",
    "PICK_SELECTOR",
    "PICK_ANCHOR"
  ].includes(type);
}
