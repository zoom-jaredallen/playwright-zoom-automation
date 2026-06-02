import { describe, expect, it } from "vitest";
import { paginateItems } from "../src/ui/pagination.js";

describe("paginateItems", () => {
  it("returns the requested page and range for a large account list", () => {
    const items = Array.from({ length: 380 }, (_, index) => `account-${index + 1}`);

    const result = paginateItems(items, { page: 3, pageSize: 50 });

    expect(result.page).toBe(3);
    expect(result.pageCount).toBe(8);
    expect(result.start).toBe(101);
    expect(result.end).toBe(150);
    expect(result.items[0]).toBe("account-101");
    expect(result.items.at(-1)).toBe("account-150");
  });

  it("clamps an out-of-range page to the final page", () => {
    const items = Array.from({ length: 380 }, (_, index) => `account-${index + 1}`);

    const result = paginateItems(items, { page: 99, pageSize: 100 });

    expect(result.page).toBe(4);
    expect(result.pageCount).toBe(4);
    expect(result.start).toBe(301);
    expect(result.end).toBe(380);
    expect(result.items).toHaveLength(80);
  });

  it("returns an empty range for an empty list", () => {
    const result = paginateItems([], { page: 1, pageSize: 50 });

    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
    expect(result.items).toEqual([]);
  });
});
