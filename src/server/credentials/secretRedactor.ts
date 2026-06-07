export function redactSecrets<T>(value: T, secrets: Array<string | undefined>): T {
  const needles = secrets.filter((secret): secret is string => Boolean(secret && secret.length > 0));
  if (needles.length === 0) return value;
  return redactValue(value, needles) as T;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactValue(nested, secrets)])
    );
  }
  return value;
}
