import { describe, expect, it } from "vitest";

import { reorder } from "./order";

describe("reorder", () => {
  const items = [
    { id: "a", sort: 10 },
    { id: "b", sort: 20 },
    { id: "c", sort: 30 },
  ];
  it("swaps with the neighbour and returns only changed sorts", () => {
    expect(reorder(items, "c", -1)).toEqual([
      { id: "c", sort: 20 },
      { id: "b", sort: 30 },
    ]);
  });
  it("renumbers messy sort values", () => {
    const messy = [
      { id: "a", sort: 0 },
      { id: "b", sort: 0 },
    ];
    expect(reorder(messy, "a", 1)).toEqual([
      { id: "b", sort: 10 },
      { id: "a", sort: 20 },
    ]);
  });
  it("ignores moves past the ends", () => {
    expect(reorder(items, "a", -1)).toEqual([]);
    expect(reorder(items, "c", 1)).toEqual([]);
    expect(reorder(items, "zzz", 1)).toEqual([]);
  });
});
