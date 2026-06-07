import type { SecretProvider } from "./types.js";

export function createEnvSecretProvider(env: NodeJS.ProcessEnv = process.env): SecretProvider {
  return {
    async getSecret(name: string): Promise<string | undefined> {
      return env[toEnvName(name)];
    },

    async listSecretNames(): Promise<string[]> {
      return Object.keys(env).filter((key) => env[key] !== undefined);
    }
  };
}

function toEnvName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}
