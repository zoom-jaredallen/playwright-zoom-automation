#!/usr/bin/env tsx
/**
 * CLI command to compile a recorded workflow JSON into a TypeScript plugin.
 *
 * Usage:
 *   npm run workflow:compile path/to/recording.json
 *   npm run workflow:compile path/to/recording.json --output src/workflows/recorded
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileWorkflow } from "./compiler.js";
import type { RecordedWorkflow } from "./types.js";

const args = process.argv.slice(2);
const inputPath = args[0];
const outputFlag = args.indexOf("--output");
const outputBase = outputFlag >= 0 && args[outputFlag + 1]
  ? args[outputFlag + 1]
  : "src/workflows/recorded";

if (!inputPath) {
  console.error("Usage: npm run workflow:compile <path-to-recording.json> [--output <dir>]");
  process.exit(1);
}

try {
  const raw = readFileSync(path.resolve(inputPath), "utf8");
  const workflow = JSON.parse(raw) as RecordedWorkflow;

  if (!workflow.version || !workflow.actions || !Array.isArray(workflow.actions)) {
    console.error("Error: Invalid workflow JSON — missing version or actions array.");
    process.exit(1);
  }

  console.log(`Compiling workflow: "${workflow.meta.name || "Untitled"}"`);
  console.log(`  Actions: ${workflow.actions.length}`);
  console.log(`  Parameters: ${workflow.parameters.length}`);
  console.log(`  Assertions: ${workflow.assertions.length}`);
  console.log("");

  const result = compileWorkflow(workflow, path.resolve(outputBase));

  console.log(`✓ Compiled successfully!`);
  console.log(`  ID: ${result.id}`);
  console.log(`  Output: ${result.outputDir}/`);
  console.log(`  Files: index.ts, flow.ts, test.ts, schema.json`);
  console.log("");
  console.log(`  Parameter check: ${result.testResults.parameterCheck}`);
  console.log(`  Selector check: ${result.testResults.selectorCheck}`);
  console.log(`  Assertion coverage: ${result.testResults.assertionCoverage}`);

  if (result.warnings.length > 0) {
    console.log("");
    console.log("  Warnings:");
    for (const warning of result.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }

  console.log("");
  console.log("Next steps:");
  console.log(`  1. Review generated code in ${result.outputDir}/`);
  console.log(`  2. Add the plugin to src/workflows/index.ts`);
  console.log(`  3. Run: npm test && npm run typecheck`);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${msg}`);
  process.exit(1);
}
