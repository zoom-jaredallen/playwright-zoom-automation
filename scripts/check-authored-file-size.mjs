#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Number(limitArg?.slice("--limit=".length) ?? 600);

const includedRoots = ["src", "extension", "packages"];
const excludedPathParts = [
  `${path.sep}dist${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}src${path.sep}workflows${path.sep}recorded${path.sep}`
];
const extensions = new Set([".ts", ".tsx"]);

const oversized = [];

for (const rootName of includedRoots) {
  walk(path.join(root, rootName));
}

for (const item of oversized.sort((a, b) => b.lines - a.lines)) {
  console.log(`${item.lines.toString().padStart(5)} ${path.relative(root, item.file)}`);
}

if (oversized.length > 0) {
  console.error(`\n${oversized.length} authored file(s) exceed ${limit} lines.`);
  process.exitCode = 1;
}

function walk(filePath) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return;
  }

  if (stats.isDirectory()) {
    for (const entry of readdirSync(filePath)) {
      walk(path.join(filePath, entry));
    }
    return;
  }

  if (!extensions.has(path.extname(filePath))) return;
  if (excludedPathParts.some((part) => filePath.includes(part))) return;

  const lines = countLines(filePath);
  if (lines > limit) oversized.push({ file: filePath, lines });
}

function countLines(filePath) {
  const data = safeRead(filePath);
  if (!data) return 0;
  return data.endsWith("\n") ? data.split("\n").length - 1 : data.split("\n").length;
}

function safeRead(filePath) {
  try {
    return statSync(filePath).size === 0 ? "" : readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
