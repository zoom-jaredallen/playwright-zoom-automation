export interface SecretProvider {
  getSecret(name: string): Promise<string | undefined>;
  setSecret?(name: string, value: string): Promise<void>;
  listSecretNames?(): Promise<string[]>;
}

export const SECRET_URI_PREFIX = "secret://";

export function isSecretReference(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SECRET_URI_PREFIX);
}

export function secretNameFromReference(value: string): string {
  return value.slice(SECRET_URI_PREFIX.length);
}
