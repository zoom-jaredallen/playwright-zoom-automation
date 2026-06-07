import type { SecretProvider } from "./types.js";
import { isSecretReference, secretNameFromReference } from "./types.js";

export async function resolveSecretReferences<T extends Record<string, string | undefined>>(
  env: T,
  provider: Pick<SecretProvider, "getSecret">,
  keys: string[]
): Promise<T> {
  const resolved = { ...env };
  for (const key of keys) {
    const value = resolved[key];
    if (!isSecretReference(value)) continue;
    const secretName = secretNameFromReference(value);
    const secret = await provider.getSecret(secretName);
    if (secret === undefined) {
      throw new Error(`Secret not found: ${secretName}`);
    }
    resolved[key as keyof T] = secret as T[keyof T];
  }
  return resolved;
}

export const CONFIG_SECRET_KEYS = [
  "ZOOM_ADMIN_PASSWORD",
  "ZOOM_API_ACCESS_TOKEN",
  "ZOOM_SERVER_TO_SERVER_CLIENT_SECRET"
] as const;
