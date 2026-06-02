import { describe, expect, it } from "vitest";
import { filterAccountsByOwnerRange } from "../src/automation/accountFilters.js";
import type { SubAccount } from "../src/automation/types.js";

describe("filterAccountsByOwnerRange", () => {
  it("keeps accounts whose owner email numeric segment is inside the inclusive range", () => {
    const accounts: SubAccount[] = [
      account("a300", "michael.chen@lab494-s300.zoomdemos.com"),
      account("a301", "michael.chen@lab494-s301.zoomdemos.com"),
      account("a325", "michael.chen@lab494-s325.zoomdemos.com"),
      account("a350", "michael.chen@lab494-s350.zoomdemos.com"),
      account("a351", "michael.chen@lab494-s351.zoomdemos.com"),
      account("other", "michael.chen@lab999-s325.zoomdemos.com")
    ];

    expect(
      filterAccountsByOwnerRange(accounts, {
        from: "michael.chen@lab494-s301.zoomdemos.com",
        to: "michael.chen@lab494-s350.zoomdemos.com"
      }).map((item) => item.id)
    ).toEqual(["a301", "a325", "a350"]);
  });

  it("falls back to owner name when owner email is unavailable", () => {
    const accounts: SubAccount[] = [
      { id: "a301", name: "Lab 301", ownerName: "michael.chen@lab494-s301.zoomdemos.com" },
      { id: "a351", name: "Lab 351", ownerName: "michael.chen@lab494-s351.zoomdemos.com" }
    ];

    expect(
      filterAccountsByOwnerRange(accounts, {
        from: "michael.chen@lab494-s301.zoomdemos.com",
        to: "michael.chen@lab494-s350.zoomdemos.com"
      }).map((item) => item.id)
    ).toEqual(["a301"]);
  });

  it("falls back to account name when Zoom does not return a dedicated owner field", () => {
    const accounts: SubAccount[] = [
      { id: "a301", name: "michael.chen@lab494-s301.zoomdemos.com" },
      { id: "a351", name: "michael.chen@lab494-s351.zoomdemos.com" }
    ];

    expect(
      filterAccountsByOwnerRange(accounts, {
        from: "michael.chen@lab494-s301.zoomdemos.com",
        to: "michael.chen@lab494-s350.zoomdemos.com"
      }).map((item) => item.id)
    ).toEqual(["a301"]);
  });

  it("rejects ranges whose endpoints do not share the same text around the number", () => {
    expect(() =>
      filterAccountsByOwnerRange([], {
        from: "michael.chen@lab494-s301.zoomdemos.com",
        to: "someone.else@lab494-s350.zoomdemos.com"
      })
    ).toThrow(/same prefix and suffix/);
  });
});

function account(id: string, ownerEmail: string): SubAccount {
  return { id, name: id, ownerEmail };
}
