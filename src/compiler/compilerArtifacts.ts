import type { RecordedAction, RecordedWorkflow } from "./types.js";
import { pascalCase } from "./nameUtils.js";

export function stripInlineCaptureThumbnails(workflow: RecordedWorkflow): RecordedWorkflow {
  return {
    ...workflow,
    actions: workflow.actions.map(stripActionInlineCaptureThumbnail)
  };
}

function stripActionInlineCaptureThumbnail(action: RecordedAction): RecordedAction {
  const next: RecordedAction = {
    ...action,
    selectors: { ...action.selectors },
    capture: action.capture ? { ...action.capture } : undefined,
    thenActions: action.thenActions?.map(stripActionInlineCaptureThumbnail),
    elseActions: action.elseActions?.map(stripActionInlineCaptureThumbnail)
  };
  if (next.capture?.thumbnail?.dataUrl) {
    delete next.capture.thumbnail;
  }
  return next;
}

export function generatePluginFile(id: string, workflow: RecordedWorkflow): string {
  const className = pascalCase(id) + "Flow";
  return `import { ${className} } from "./flow.js";
import type { WorkflowPlugin } from "../../types.js";

const plugin: WorkflowPlugin = {
  id: "${id}",
  name: ${JSON.stringify(workflow.meta.name)},
  description: ${JSON.stringify(workflow.meta.description)},
  enabled: true,
  category: "${workflow.meta.category}",
  createFlow(context) {
    return new ${className}(context);
  }
};

export default plugin;
`;
}

export function generateTestFile(id: string, workflow: RecordedWorkflow): string {
  const className = pascalCase(id) + "Flow";
  return `import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("${className}", () => {
  it("exports a valid workflow plugin", () => {
    expect(plugin.id).toBe("${id}");
    expect(plugin.name).toBeTruthy();
    expect(plugin.enabled).toBe(true);
    expect(plugin.createFlow).toBeTypeOf("function");
  });

  it("has ${workflow.parameters.length} parameter(s) defined in schema", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.parameters).toHaveLength(${workflow.parameters.length});
${workflow.parameters.map((p) => `    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "${p.name}", required: ${p.required} }));`).join("\n")}
  });

  it("has ${workflow.assertions.length} assertion(s) for verification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.assertions).toHaveLength(${workflow.assertions.length});
  });

  it("has ${workflow.actions.length} recorded action(s)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.actions).toHaveLength(${workflow.actions.length});
  });
});
`;
}

export function validateParameters(workflow: RecordedWorkflow): boolean {
  return workflow.parameters.every((p) => p.name && p.source);
}

export function validateSelectors(workflow: RecordedWorkflow, warnings: string[]): boolean {
  let allValid = true;
  for (const action of workflow.actions) {
    if (["navigate", "wait", "assert", "screenshot", "dismiss", "dialog"].includes(action.type)) continue;
    const s = action.selectors;
    const hasStable = Boolean(s.role || s.label || s.text || s.testId);
    if (!hasStable && s.css) {
      warnings.push(`Action "${action.description ?? action.id}": only CSS selector available — may be unstable`);
      allValid = false;
    }
  }
  return allValid;
}

export function calculateAssertionCoverage(workflow: RecordedWorkflow): number {
  const submitActions = workflow.actions.filter((a) => {
    if (a.type !== "click") return false;
    const name = a.selectors.role?.name ?? a.selectors.text ?? "";
    return /save|submit|add|continue|confirm/i.test(name);
  });
  if (submitActions.length === 0) return 100;
  const covered = submitActions.filter((a) =>
    workflow.assertions.some((assertion) => assertion.afterAction === a.id)
  );
  return Math.round((covered.length / submitActions.length) * 100);
}
