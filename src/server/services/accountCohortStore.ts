import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AccountSelectionFilters } from "./accountSelectionService.js";

export interface AccountCohort {
  id: string;
  name: string;
  accountIds: string[];
  filters?: AccountSelectionFilters;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountCohortInput {
  name: string;
  accountIds: string[];
  filters?: AccountSelectionFilters;
}

export interface AccountCohortStore {
  list(): AccountCohort[];
  get(id: string): AccountCohort | undefined;
  create(input: CreateAccountCohortInput): AccountCohort;
  update(id: string, patch: Partial<CreateAccountCohortInput>): AccountCohort;
  delete(id: string): boolean;
}

export function createAccountCohortStore(directory: string): AccountCohortStore {
  mkdirSync(directory, { recursive: true });

  const read = (id: string): AccountCohort | undefined => {
    try {
      return JSON.parse(readFileSync(filePath(directory, id), "utf8")) as AccountCohort;
    } catch {
      return undefined;
    }
  };

  const write = (cohort: AccountCohort): void => {
    mkdirSync(directory, { recursive: true });
    const target = filePath(directory, cohort.id);
    const temp = `${target}.tmp`;
    writeFileSync(temp, `${JSON.stringify(cohort, null, 2)}\n`, "utf8");
    renameSync(temp, target);
  };

  return {
    list() {
      return readdirSync(directory)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => read(path.basename(entry, ".json")))
        .filter((cohort): cohort is AccountCohort => Boolean(cohort))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get(id) {
      return read(id);
    },
    create(input) {
      const now = new Date().toISOString();
      const cohort: AccountCohort = {
        id: `cohort_${randomUUID()}`,
        name: input.name.trim(),
        accountIds: unique(input.accountIds),
        filters: input.filters,
        createdAt: now,
        updatedAt: now
      };
      write(cohort);
      return clone(cohort);
    },
    update(id, patch) {
      const current = read(id);
      if (!current) throw new Error(`Cohort not found: ${id}`);
      const next: AccountCohort = {
        ...current,
        name: patch.name?.trim() ?? current.name,
        accountIds: patch.accountIds ? unique(patch.accountIds) : current.accountIds,
        filters: patch.filters ?? current.filters,
        updatedAt: new Date().toISOString()
      };
      write(next);
      return clone(next);
    },
    delete(id) {
      const target = filePath(directory, id);
      try {
        rmSync(target);
        return true;
      } catch {
        return false;
      }
    }
  };
}

function filePath(directory: string, id: string): string {
  const resolved = path.resolve(directory, `${id}.json`);
  const base = path.resolve(directory);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error(`Invalid cohort id: ${id}`);
  return resolved;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clone(cohort: AccountCohort): AccountCohort {
  return JSON.parse(JSON.stringify(cohort)) as AccountCohort;
}
