# Modularization Guidelines

This project contains a mix of hand-authored automation code, Chrome extension
code, Web UI code, and generated recorded workflow output. Keep refactors focused
on authored files and preserve generated workflow behavior unless a workflow is
being intentionally recompiled.

## File Size Boundary

- Target authored TypeScript files at 600 lines or fewer.
- Treat 600 lines as a soft design boundary, not a reason to create vague helper
  modules.
- Exclude generated workflow files under `src/workflows/recorded/**`.
- Use `npm run check:file-size` to report authored files over the boundary.

## Module Boundaries

Prefer modules named after responsibilities rather than implementation details:

- Chrome background: message routing, recording session state, workflow storage,
  capture, preflight/replay, debug bridge, and extension reload.
- Chrome content recorder: DOM event capture, action creation, Zoom component
  detection, anchor inference, browser-side preflight, and messaging.
- Chrome side panel: state, step list, step editor, inspector, import/export, and
  preflight/test controls.
- Server: one route module per API area, with `app.ts` reserved for composition.
- Compiler: orchestration, schema sanitization, flow generation, action codegen,
  plugin generation, and test generation.
- Selector runtime: selector resolution, anchor scoping, fallback candidates,
  diagnostics, and Zoom-specific matching.
- Web UI: page shell, account query state, workflow selection state, run monitor
  state, import/editor state, and focused components.

## Refactor Rules

- Keep behavior changes out of pure modularization commits.
- Preserve public message/API shapes until all consumers are migrated.
- Add characterization tests before changing high-risk flows.
- Verify each phase before committing.
- Avoid `utils.ts` catch-all modules. If a module name cannot describe a concrete
  responsibility, the extraction boundary is probably wrong.
