import path from "node:path";

export function resolveBuiltUiPath(serverDir: string): string {
  return path.resolve(serverDir, "../../dist/ui");
}

export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
