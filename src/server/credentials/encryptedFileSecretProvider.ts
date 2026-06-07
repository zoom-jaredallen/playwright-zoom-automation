import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SecretProvider } from "./types.js";

interface VaultFile {
  version: 1;
  secrets: Record<string, EncryptedSecret>;
}

interface EncryptedSecret {
  iv: string;
  tag: string;
  value: string;
}

export interface EncryptedFileSecretProviderOptions {
  filePath: string;
  key: string;
}

export function createEncryptedFileSecretProvider(options: EncryptedFileSecretProviderOptions): Required<SecretProvider> {
  const filePath = path.resolve(options.filePath);
  const key = normalizeKey(options.key);
  mkdirSync(path.dirname(filePath), { recursive: true });

  const readVault = (): VaultFile => {
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as VaultFile;
    } catch {
      return { version: 1, secrets: {} };
    }
  };

  const writeVault = (vault: VaultFile): void => {
    const temp = `${filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(vault, null, 2)}\n`, "utf8");
    renameSync(temp, filePath);
  };

  return {
    async getSecret(name: string): Promise<string | undefined> {
      const secret = readVault().secrets[name];
      if (!secret) return undefined;
      return decrypt(secret, key);
    },

    async setSecret(name: string, value: string): Promise<void> {
      const vault = readVault();
      vault.secrets[name] = encrypt(value, key);
      writeVault(vault);
    },

    async listSecretNames(): Promise<string[]> {
      return Object.keys(readVault().secrets).sort();
    }
  };
}

function encrypt(value: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    value: encrypted.toString("base64")
  };
}

function decrypt(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.value, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function normalizeKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}
