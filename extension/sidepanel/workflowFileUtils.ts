import type { RecordedWorkflow } from "../shared/types.js";

export function parseWorkflowJson(rawJson: string): RecordedWorkflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (!isRecordedWorkflow(parsed)) {
    throw new Error("The selected file is not a recorded workflow JSON file.");
  }
  if (parsed.actions.length === 0) {
    throw new Error("The selected workflow does not contain any steps.");
  }
  return parsed;
}

export function isRecordedWorkflow(value: unknown): value is RecordedWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecordedWorkflow>;
  return candidate.version === 1
    && Boolean(candidate.meta && typeof candidate.meta === "object")
    && Array.isArray(candidate.actions);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
