import { useEffect, useMemo, useState } from "react";
import type { AccountQueryFilters, SubAccountView } from "../api.js";
import { paginateItems } from "../pagination.js";
import { ChevronRightIcon, RefreshIcon, SearchIcon } from "./Icons.js";

interface AccountQueryPanelProps {
  filters: AccountQueryFilters;
  accounts: SubAccountView[];
  selectedIds: Set<string>;
  loading: boolean;
  error?: string;
  total?: number;
  accountStatuses?: Map<string, { status: string; message?: string }>;
  onFiltersChange(filters: AccountQueryFilters): void;
  onQuery(): void;
  onToggle(accountId: string): void;
  onTogglePage(accountIds: string[], selected: boolean): void;
}

export function AccountQueryPanel({
  filters,
  accounts,
  selectedIds,
  loading,
  error,
  total,
  accountStatuses,
  onFiltersChange,
  onQuery,
  onToggle,
  onTogglePage
}: AccountQueryPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const pagination = useMemo(() => paginateItems(accounts, { page, pageSize }), [accounts, page, pageSize]);
  const visibleAccounts = pagination.items;
  const visibleAccountIds = visibleAccounts.map((account) => account.id);
  const pageSelected = visibleAccounts.length > 0 && visibleAccounts.every((account) => selectedIds.has(account.id));

  useEffect(() => {
    setPage(1);
  }, [accounts]);

  useEffect(() => {
    if (pagination.page !== page) {
      setPage(pagination.page);
    }
  }, [page, pagination.page]);

  return (
    <section className="panel account-panel" id="accounts">
      <div className="panel-header">
        <div>
          <h2>Sub accounts</h2>
          <p>Query the master account, refine the scope, and select accounts for automation.</p>
        </div>
        <button className="primary-button" onClick={onQuery} disabled={loading}>
          <RefreshIcon />
          {loading ? "Querying" : "Query accounts"}
        </button>
      </div>

      <div className="filter-grid">
        <label className="field">
          <span>Owner from</span>
          <input
            value={filters.ownerRange?.from ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                ownerRange: {
                  from: event.target.value,
                  to: filters.ownerRange?.to ?? ""
                }
              })
            }
            placeholder="michael.chen@lab494-s301.zoomdemos.com"
          />
        </label>
        <label className="field">
          <span>Owner to</span>
          <input
            value={filters.ownerRange?.to ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                ownerRange: {
                  from: filters.ownerRange?.from ?? "",
                  to: event.target.value
                }
              })
            }
            placeholder="michael.chen@lab494-s350.zoomdemos.com"
          />
        </label>
        <label className="field field-search">
          <span>Search</span>
          <div className="input-with-icon">
            <SearchIcon />
            <input
              value={filters.search ?? ""}
              onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
              placeholder="Name, owner, or account ID"
            />
          </div>
        </label>
        <label className="field field-small">
          <span>Max results</span>
          <input
            type="number"
            min="1"
            value={filters.limit ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                limit: event.target.value ? Number.parseInt(event.target.value, 10) : undefined
              })
            }
          />
        </label>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="table-toolbar">
        <span>
          {pagination.start}-{pagination.end} shown from {accounts.length}
          {typeof total === "number" ? ` filtered from ${total}` : ""}. {selectedIds.size} selected.
        </span>
        <button
          className="tertiary-button"
          onClick={() => onTogglePage(visibleAccountIds, !pageSelected)}
          disabled={visibleAccounts.length === 0}
        >
          {pageSelected ? "Clear page" : "Select page"}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  type="checkbox"
                  aria-label="Select current page accounts"
                  checked={pageSelected}
                  onChange={() => onTogglePage(visibleAccountIds, !pageSelected)}
                />
              </th>
              <th>Account</th>
              <th>Owner</th>
              <th>Account ID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  Query accounts to populate this table.
                </td>
              </tr>
            ) : (
              visibleAccounts.map((account) => {
                const lastStatus = accountStatuses?.get(account.id);
                const badge = lastStatus
                  ? { label: lastStatus.status, cls: statusBadgeClass(lastStatus.status) }
                  : { label: "Ready", cls: "neutral" };
                return (
                  <tr key={account.id} className={selectedIds.has(account.id) ? "selected-row" : ""}>
                    <td className="checkbox-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${account.name}`}
                        checked={selectedIds.has(account.id)}
                        onChange={() => onToggle(account.id)}
                      />
                    </td>
                    <td>
                      <strong>{account.name}</strong>
                    </td>
                    <td>{account.ownerEmail ?? account.ownerName ?? "—"}</td>
                    <td>
                      <code>{account.id}</code>
                    </td>
                    <td>
                      <span className={`status-badge ${badge.cls}`} title={lastStatus?.message}>
                        {badge.label.charAt(0).toUpperCase() + badge.label.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-bar">
        <label className="pagination-size">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number.parseInt(event.target.value, 10));
              setPage(1);
            }}
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <span className="pagination-count">
          Page {pagination.page} of {pagination.pageCount}
        </span>
        <div className="pagination-actions">
          <button
            className="icon-button"
            aria-label="Previous page"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={pagination.page <= 1}
          >
            <ChevronRightIcon className="chevron-left" />
          </button>
          <button
            className="icon-button"
            aria-label="Next page"
            onClick={() => setPage((current) => Math.min(pagination.pageCount, current + 1))}
            disabled={pagination.page >= pagination.pageCount}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

function statusBadgeClass(status: string): string {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "skipped") return "neutral";
  if (status === "running") return "primary";
  return "neutral";
}
