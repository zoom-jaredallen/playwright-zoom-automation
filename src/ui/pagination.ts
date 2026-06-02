export interface PaginationState {
  page: number;
  pageSize: number;
}

export interface PaginationResult<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  items: T[];
}

export function paginateItems<T>(items: T[], state: PaginationState): PaginationResult<T> {
  const pageSize = Math.max(1, state.pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, state.page), pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    page,
    pageSize,
    pageCount,
    total: items.length,
    start: pageItems.length === 0 ? 0 : startIndex + 1,
    end: startIndex + pageItems.length,
    items: pageItems
  };
}
