export function optionTextMatches(expected: string, actual: string): boolean {
  const expectedTokens = meaningfulTokens(expected);
  const actualTokens = new Set(meaningfulTokens(actual));

  if (expectedTokens.length === 0) return false;

  const normalizedExpected = normalizeForOptionMatch(expected);
  const normalizedActual = normalizeForOptionMatch(actual);
  if (normalizedExpected === normalizedActual) return true;

  return expectedTokens.every((token) => actualTokens.has(token));
}

export function selectedOptionValueMatches(expected: string, actual: string): boolean {
  if (optionTextMatches(expected, actual)) return true;

  const normalizedActual = normalizeForOptionMatch(actual);
  return primaryOptionTexts(expected).some((primaryExpected) =>
    normalizedActual === normalizeForOptionMatch(primaryExpected)
  );
}

export function normalizeForOptionMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryOptionTexts(value: string): string[] {
  return [
    value.split(/\s+-\s+/)[0],
    value.split(",")[0]
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
}

function meaningfulTokens(value: string): string[] {
  return normalizeForOptionMatch(value)
    .split(" ")
    .filter((token) => token.length > 1);
}
