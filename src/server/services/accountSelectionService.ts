import { filterAccountsByOwnerRange, type OwnerRange } from "../../automation/accountFilters.js";
import type { SubAccount } from "../../automation/types.js";

export interface AccountSelectionFilters {
  ownerRange?: OwnerRange;
  search?: string;
  ids?: string[];
  limit?: number;
}

export function filterSelectableAccounts(accounts: SubAccount[], filters: AccountSelectionFilters): SubAccount[] {
  let selected = [...accounts];

  if (filters.ids && filters.ids.length > 0) {
    const allowed = new Set(filters.ids);
    selected = selected.filter((account) => allowed.has(account.id));
  }

  if (filters.ownerRange) {
    selected = filterAccountsByOwnerRange(selected, filters.ownerRange);
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    selected = selected.filter((account) =>
      [account.id, account.name, account.ownerEmail, account.ownerName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(search))
    );
  }

  if (filters.limit) {
    selected = selected.slice(0, filters.limit);
  }

  return selected;
}
