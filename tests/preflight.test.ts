import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocumentFiles } from "../src/preflight.js";

describe("validateDocumentFiles", () => {
  it("accepts configured document files that exist and are below Zoom's size limit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zoom-docs-"));
    try {
      const idPath = path.join(directory, "id.pdf");
      const businessPath = path.join(directory, "business.pdf");
      await writeFile(idPath, "id");
      await writeFile(businessPath, "business");

      await expect(
        validateDocumentFiles({
          required: true,
          idPath,
          businessVerificationPath: businessPath
        })
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports missing document files before the browser automation starts", async () => {
    await expect(
      validateDocumentFiles({
        required: true,
        businessVerificationPath: "/tmp/zoom-missing-business.pdf"
      })
    ).rejects.toThrow(/Document preflight failed.*DOCUMENT_BUSINESS_VERIFICATION_PATH/s);
  });

  it("allows missing paths when documents are not required for the selected profile", async () => {
    await expect(
      validateDocumentFiles({
        required: false
      })
    ).resolves.toBeUndefined();
  });

  it("allows a required document profile with only one configured document type", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zoom-docs-"));
    try {
      const businessPath = path.join(directory, "business.pdf");
      await writeFile(businessPath, "business");

      await expect(
        validateDocumentFiles({
          required: true,
          businessVerificationPath: businessPath
        })
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
