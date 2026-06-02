import type { SubAccount } from "./types.js";

export interface OwnerRange {
  from: string;
  to: string;
}

interface ParsedOwnerRange {
  prefix: string;
  suffix: string;
  from: number;
  to: number;
}

export function filterAccountsByOwnerRange(accounts: SubAccount[], range: OwnerRange): SubAccount[] {
  const parsedRange = parseOwnerRange(range);
  return accounts.filter((account) => {
    const ownerIdentifier = account.ownerEmail ?? account.ownerName ?? account.name;
    if (!ownerIdentifier) {
      return false;
    }

    const parsedOwner = parseNumberedIdentifier(ownerIdentifier);
    if (!parsedOwner) {
      return false;
    }

    return (
      parsedOwner.prefix === parsedRange.prefix &&
      parsedOwner.suffix === parsedRange.suffix &&
      parsedOwner.value >= parsedRange.from &&
      parsedOwner.value <= parsedRange.to
    );
  });
}

function parseOwnerRange(range: OwnerRange): ParsedOwnerRange {
  const from = parseNumberedIdentifier(range.from);
  const to = parseNumberedIdentifier(range.to);
  if (!from || !to) {
    throw new Error("SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must each contain a numeric segment");
  }

  if (from.prefix !== to.prefix || from.suffix !== to.suffix) {
    throw new Error("SUB_ACCOUNT_OWNER_FROM and SUB_ACCOUNT_OWNER_TO must use the same prefix and suffix");
  }

  if (from.value > to.value) {
    throw new Error("SUB_ACCOUNT_OWNER_FROM must be less than or equal to SUB_ACCOUNT_OWNER_TO");
  }

  return {
    prefix: from.prefix,
    suffix: from.suffix,
    from: from.value,
    to: to.value
  };
}

function parseNumberedIdentifier(value: string): { prefix: string; value: number; suffix: string } | undefined {
  const match = value.trim().match(/^(.*?)(\d+)(\D*)$/);
  if (!match) {
    return undefined;
  }

  return {
    prefix: match[1].toLowerCase(),
    value: Number.parseInt(match[2], 10),
    suffix: match[3].toLowerCase()
  };
}
