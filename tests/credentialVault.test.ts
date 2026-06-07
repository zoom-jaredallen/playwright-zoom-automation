import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEncryptedFileSecretProvider } from "../src/server/credentials/encryptedFileSecretProvider.js";
import { redactSecrets } from "../src/server/credentials/secretRedactor.js";
import { resolveSecretReferences } from "../src/server/credentials/credentialResolver.js";

describe("credential vault", () => {
  it("stores encrypted secrets without writing plaintext values", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "zoom-credentials-"));
    const filePath = path.join(directory, "vault.json");
    try {
      const provider = createEncryptedFileSecretProvider({
        filePath,
        key: "0123456789abcdef0123456789abcdef"
      });

      await provider.setSecret("zoom/admin-password", "super-secret-password");
      expect(await provider.getSecret("zoom/admin-password")).toBe("super-secret-password");
      expect(readFileSync(filePath, "utf8")).not.toContain("super-secret-password");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves secret URI environment values before config validation", async () => {
    const provider = {
      async getSecret(name: string) {
        return name === "zoom/admin-password" ? "resolved-password" : undefined;
      }
    };

    const env = await resolveSecretReferences({
      ZOOM_ADMIN_EMAIL: "admin@example.com",
      ZOOM_ADMIN_PASSWORD: "secret://zoom/admin-password"
    }, provider, ["ZOOM_ADMIN_PASSWORD"]);

    expect(env.ZOOM_ADMIN_PASSWORD).toBe("resolved-password");
  });

  it("redacts nested secret values from logs and payloads", () => {
    const payload = {
      message: "using super-secret-password",
      nested: { token: "api-token" },
      list: ["safe", "api-token"]
    };

    expect(redactSecrets(payload, ["super-secret-password", "api-token"])).toEqual({
      message: "using [REDACTED]",
      nested: { token: "[REDACTED]" },
      list: ["safe", "[REDACTED]"]
    });
  });
});
