/**
 * The recorded-workflow schema now lives in the shared `@zoom-automation/workflow-core`
 * package. This module re-exports it so the compiler's existing relative imports
 * (`./types.js`) keep working, and adds the compiler-only `CompileResult`.
 */
export * from "@zoom-automation/workflow-core";

export interface CompileResult {
  id: string;
  outputDir: string;
  warnings: string[];
  testResults: {
    parameterCheck: "passed" | "failed";
    selectorCheck: "passed" | "failed";
    assertionCoverage: string;
  };
}
