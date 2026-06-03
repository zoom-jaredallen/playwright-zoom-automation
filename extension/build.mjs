/**
 * Build script for the Chrome extension.
 * Uses esbuild to bundle each entry point (content script, background worker, popup)
 * into standalone JS files that Chrome can load without ES module imports.
 */
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";

// Ensure output directory exists
mkdirSync(outdir, { recursive: true });

// Common build options
const commonOptions = {
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  minify: !watch,
};

// Build all entry points
const entryPoints = [
  {
    entryPoints: ["content/recorder.ts"],
    outfile: `${outdir}/content/recorder.js`,
    ...commonOptions,
  },
  {
    entryPoints: ["background/service-worker.ts"],
    outfile: `${outdir}/background/service-worker.js`,
    format: "esm", // Service workers support ES modules
    bundle: true,
    target: "chrome120",
    sourcemap: true,
    minify: !watch,
  },
  {
    entryPoints: ["popup/popup.ts"],
    outfile: `${outdir}/popup/popup.js`,
    ...commonOptions,
  },
  {
    entryPoints: ["sidepanel/sidepanel.ts"],
    outfile: `${outdir}/sidepanel/sidepanel.js`,
    ...commonOptions,
  },
];

async function build() {
  try {
    for (const options of entryPoints) {
      if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log(`Watching: ${options.entryPoints[0]}`);
      } else {
        await esbuild.build(options);
        console.log(`Built: ${options.outfile}`);
      }
    }

    // Copy static files to dist
    cpSync("manifest.json", `${outdir}/manifest.json`);
    cpSync("popup/popup.html", `${outdir}/popup/popup.html`);
    cpSync("popup/popup.css", `${outdir}/popup/popup.css`);
    mkdirSync(`${outdir}/sidepanel`, { recursive: true });
    cpSync("sidepanel/sidepanel.html", `${outdir}/sidepanel/sidepanel.html`);
    cpSync("sidepanel/sidepanel.css", `${outdir}/sidepanel/sidepanel.css`);
    mkdirSync(`${outdir}/icons`, { recursive: true });
    cpSync("icons", `${outdir}/icons`, { recursive: true });

    console.log("\n✓ Extension built successfully!");
    console.log(`  Output: ${path.resolve(outdir)}/`);
    console.log("  Load this folder in chrome://extensions (Developer mode → Load unpacked)");

    if (watch) {
      console.log("\n  Watching for changes... (Ctrl+C to stop)");
    }
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
