import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("AddAuContactCenterBusinessAddressFlow", () => {
  it("exports a valid workflow plugin", () => {
    expect(plugin.id).toBe("add-au-contact-center-business-address");
    expect(plugin.name).toBeTruthy();
    expect(plugin.enabled).toBe(true);
    expect(plugin.createFlow).toBeTypeOf("function");
  });

  it("has 7 parameter(s) defined in schema", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.parameters).toHaveLength(7);
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.country", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.line1", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.line2", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.state", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.city", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "address.postalCode", required: true }));
    expect(schema.parameters).toContainEqual(expect.objectContaining({ name: "customerName", required: true }));
  });

  it("has 2 assertion(s) for verification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.assertions).toHaveLength(2);
  });

  it("has 12 recorded action(s)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "schema.json"), "utf8"));
    expect(schema.actions).toHaveLength(12);
  });
});
