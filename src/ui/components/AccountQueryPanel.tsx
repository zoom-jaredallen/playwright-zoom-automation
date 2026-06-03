import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountQueryFilters, SubAccountView } from "../api.js";
import { paginateItems } from "../pagination.js";
import { ChevronRightIcon, RefreshIcon, SearchIcon } from "./Icons.js";

type SortColumn = "name" | "owner" | "id" | "status";
type SortDirection = "asc" | "desc";

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
  const [sortColumn, setSortColumn] = useState<SortColumn | undefined>();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedAccounts = useMemo(() => {
    if (!sortColumn) return accounts;
    const sorted = [...accounts].sort((a, b) => {
      let aVal = "";
      let bVal = "";
      switch (sortColumn) {
        case "name": aVal = a.name; bVal = b.name; break;
        case "owner": aVal = a.ownerEmail ?? a.ownerName ?? ""; bVal = b.ownerEmail ?? b.ownerName ?? ""; break;
        case "id": aVal = a.id; bVal = b.id; break;
        case "status": {
          const aStatus = accountStatuses?.get(a.id)?.status ?? "ready";
          const bStatus = accountStatuses?.get(b.id)?.status ?? "ready";
          aVal = aStatus; bVal = bStatus; break;
        }
      }
      const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [accounts, sortColumn, sortDirection, accountStatuses]);

  const pagination = useMemo(() => paginateItems(sortedAccounts, { page, pageSize }), [sortedAccounts, page, pageSize]);
  const visibleAccounts = pagination.items;
  const visibleAccountIds = visibleAccounts.map((account) => account.id);
  const pageSelected = visibleAccounts.length > 0 && visibleAccounts.every((account) => selectedIds.has(account.id));

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setPage(1);
  }, [sortColumn]);

  const handleExportCsv = useCallback(() => {
    const rows = [["Account Name", "Owner", "Account ID", "Status"]];
    for (const account of sortedAccounts) {
      const status = accountStatuses?.get(account.id)?.status ?? "Ready";
      rows.push([
        account.name,
        account.ownerEmail ?? account.ownerName ?? "",
        account.id,
        status
      ]);
    }
    const csv = rows.map((row) => row.map((cell) => {
      if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedAccounts, accountStatuses]);

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
          {selectedIds.size} / {accounts.length} selected
          {typeof total === "number" && total !== accounts.length ? ` (${total} total)` : ""}
        </span>
        <div className="table-toolbar-actions">
          <button
            className="tertiary-button"
            onClick={() => onTogglePage(visibleAccountIds, !pageSelected)}
            disabled={visibleAccounts.length === 0}
          >
            {pageSelected ? "Clear page" : "Select page"}
          </button>
          <button
            className="tertiary-button"
            onClick={() => {
              const allIds = accounts.map((a) => a.id);
              const allSelected = allIds.every((id) => selectedIds.has(id));
              onTogglePage(allIds, !allSelected);
            }}
            disabled={accounts.length === 0}
          >
            {accounts.length > 0 && accounts.every((a) => selectedIds.has(a.id)) ? "Deselect all" : "Select all"}
          </button>
          <button
            className="tertiary-button"
            onClick={handleExportCsv}
            disabled={accounts.length === 0}
            title="Export accounts to CSV"
          >
            ↓ CSV
          </button>
        </div>
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
              <SortableHeader column="name" label="Account" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader column="owner" label="Owner" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader column="id" label="Account ID" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
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
                    <td title={account.ownerEmail ?? account.ownerName ?? ""}>
                      {account.ownerEmail ?? account.ownerName ?? "—"}
                    </td>
                    <td title={account.id} className="account-id-cell">
                      <code>{account.id}</code>
                      <button
                        className="copy-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(account.id);
                          const btn = e.currentTarget;
                          btn.textContent = "✓";
                          setTimeout(() => { btn.textContent = "⎘"; }, 1500);
                        }}
                        aria-label={`Copy account ID ${account.id}`}
                        title="Copy ID"
                      >⎘</button>
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

function SortableHeader({ column, label, sortColumn, sortDirection, onSort }: {
  column: SortColumn;
  label: string;
  sortColumn: SortColumn | undefined;
  sortDirection: SortDirection;
  onSort(column: SortColumn): void;
}) {
  const active = sortColumn === column;
  return (
    <th
      className={`sortable-th ${active ? "sorted" : ""}`}
      onClick={() => onSort(column)}
      aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="th-content">
        {label}
        <span className="sort-indicator">
          {active ? (sortDirection === "asc" ? "↑" : "↓") : "⇅"}
        </span>
      </span>
    </th>
  );
}
