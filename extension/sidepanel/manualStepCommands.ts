import { type AssertionType } from "@zoom-automation/workflow-core";
import { defaultAssertionInput } from "../shared/assertionCatalog.js";
import type { ExtensionMessage } from "../shared/types.js";

export interface ManualStepDeps {
  insertAfterActionId: string | null | undefined;
  sendMessage(message: ExtensionMessage): Promise<any>;
  selectAndExpandAction(actionId: string | undefined): void;
  setInsertAfterActionId(actionId: string | null | undefined): void;
  setMessage(message: string): void;
  refreshState(): Promise<void>;
}

export async function addAssertionStep(deps: ManualStepDeps, assertionType: AssertionType = "textVisible"): Promise<void> {
  const defaults = defaultAssertionInput(assertionType);
  const response = await deps.sendMessage({
    type: "ADD_ASSERTION_ACTION",
    assertionType: defaults.assertionType,
    expected: defaults.expected ?? "",
    timeout: defaults.timeout,
    onFailure: defaults.onFailure,
    insertAfterActionId: deps.insertAfterActionId
  });
  await finishAddedStep(deps, response?.actionId, "Validation step added. Configure it in the step.");
}

export async function addClickStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_CLICK_ACTION", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Click step added. Add a stable selector in Selector details.");
}

export async function addFillStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_FILL_ACTION", value: "", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Text entry step added. Configure the value and selector in the step.");
}

export async function addSelectStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_SELECT_ACTION", value: "", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Select option step added. Configure the option and selector in the step.");
}

export async function addPressStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_PRESS_ACTION", key: "Enter", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Key press step added. Configure the key in the step.");
}

export async function addScreenshotStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_SCREENSHOT_ACTION", label: "evidence", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Screenshot step added. Configure it in the step.");
}

export async function addWaitStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_WAIT_ACTION", waitMs: 1_000, insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Wait step added. Configure it in the step.");
}

export async function addDismissStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_DISMISS_ACTION", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Dismiss popup step added.");
}

export async function addNavigationStep(deps: ManualStepDeps): Promise<void> {
  const response = await deps.sendMessage({ type: "ADD_NAVIGATION_ACTION", url: "/", insertAfterActionId: deps.insertAfterActionId });
  await finishAddedStep(deps, response?.actionId, "Navigation step added. Configure it in the step.");
}

async function finishAddedStep(deps: ManualStepDeps, actionId: string | undefined, message: string): Promise<void> {
  deps.selectAndExpandAction(actionId);
  deps.setInsertAfterActionId(undefined);
  deps.setMessage(message);
  await deps.refreshState();
}
