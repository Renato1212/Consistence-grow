import { describe, expect, it } from "vitest";

import { aggregateDaily, intensity, monthGrid } from "./heatmap";

describe("aggregateDaily", () => {
  it("sums taken trades per Lisbon day, R only where a stop existed, per currency", () => {
    const days = aggregateDaily([
      { trade_date: "2026-09-15", kind: "taken", net_pnl: 200, r_multiple: 1.5, currency: "USD" },
      {
        trade_date: "2026-09-15",
        kind: "taken",
        net_pnl: -100.1,
        r_multiple: null,
        currency: "USD",
      },
      { trade_date: "2026-09-15", kind: "taken", net_pnl: 50, r_multiple: 0.5, currency: "EUR" },
      { trade_date: "2026-09-15", kind: "missed", net_pnl: 999, r_multiple: 9, currency: "USD" },
      { trade_date: "2026-09-15", kind: "taken", net_pnl: null, r_multiple: null, currency: "USD" },
      { trade_date: "2026-09-16", kind: "taken", net_pnl: -50, r_multiple: -1, currency: "USD" },
    ]);
    expect(days.get("2026-09-15")).toEqual({
      date: "2026-09-15",
      n: 3,
      netR: 2,
      rN: 2,
      net: { USD: 99.9, EUR: 50 },
    });
    expect(days.get("2026-09-16")?.netR).toBe(-1);
    expect(days.size).toBe(2);
  });
});

describe("monthGrid", () => {
  it("lays out September 2026 Monday-first", () => {
    const g = monthGrid(2026, 9); // 1 Sep 2026 is a Tuesday
    expect(g[0]).toEqual([
      null,
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
  it("handles February in a leap-free year", () => {
    expect(monthGrid(2026, 2).flat().filter(Boolean)).toHaveLength(28);
  });
});

describe("intensity", () => {
  it("scales by the largest absolute day", () => {
    expect(intensity(50, 200)).toBe(0.25);
    expect(intensity(-200, 200)).toBe(1);
    expect(intensity(10, 0)).toBe(0);
  });
});
