import { describe, expect, it } from "vitest";

import {
  accountStats,
  continuityGaps,
  equityCurve,
  processLens,
  productStats,
  reconSummary,
  reconcile,
  sizeBuckets,
  volumeCorrelation,
  weekdayRows,
  type DayContext,
  type DayProduct,
  type StatementDay,
  verifyTrades,
} from "./analysis";

const MES = { id: "i-mes", tickSize: 0.25, tickValue: 1.25 };
const ZN = { id: "i-zn", tickSize: 0.015625, tickValue: 15.625 };

function prod(
  symbol: "MES" | "ZN" | null,
  realized: number,
  qty: number,
  extra: Partial<DayProduct> = {},
): DayProduct {
  const inst = symbol === "MES" ? MES : symbol === "ZN" ? ZN : null;
  return {
    code: symbol === "MES" ? "MS" : symbol === "ZN" ? "21" : "XX",
    contract: "DEC-26",
    description: "",
    instrumentId: inst?.id ?? null,
    symbol,
    tickSize: inst?.tickSize ?? null,
    tickValue: inst?.tickValue ?? null,
    priceScale: 1,
    impliedMultiplier: symbol === "MES" ? 5 : symbol === "ZN" ? 1000 : null,
    longQty: qty,
    shortQty: qty,
    fills: 2,
    realized,
    ...extra,
  };
}

function day(
  date: string,
  products: DayProduct[],
  nlv: number | null = null,
  t1?: number,
): StatementDay {
  const realized = products.reduce((s, p) => s + (p.realized ?? 0), 0);
  return {
    id: `s-${date}`,
    account: "A",
    tradeDate: date,
    realized,
    fees: 0,
    net: realized,
    nlv,
    contracts: products.reduce((s, p) => s + p.longQty + p.shortQty, 0),
    fills: 0,
    status: "ok",
    simulated: true,
    nlvHistory: t1 === undefined ? [] : [{ offset: -1, nlv: t1, change: null }],
    products,
  };
}

// Mon 21 → Fri 25 Sep 2026
const DAYS = [
  day("2026-09-21", [prod("MES", 100, 2), prod("ZN", 50, 1)], 10150, 10000),
  day("2026-09-22", [prod("MES", -300, 10)], 9850, 10150),
  day("2026-09-23", [prod("ZN", 200, 2)], 10050, 9850),
  day("2026-09-24", [prod("MES", -500, 20)], 9550, 10000), // T-1 mismatch → gap
  day("2026-09-25", [prod("MES", 80, 3), prod(null, 20, 1)], 9650, 9550),
];

describe("account stats", () => {
  it("summarises days with honest counts", () => {
    const s = accountStats(DAYS);
    expect(s).toMatchObject({
      n: 5,
      net: -350,
      wins: 3,
      losses: 2,
      avgWin: 150,
      avgLoss: -400,
      profitFactor: 0.56,
      best: { date: "2026-09-23", net: 200 },
      worst: { date: "2026-09-24", net: -500 },
      maxDrawdown: -600,
      longestWin: 1,
      longestLoss: 1,
      contracts: 78,
    });
    expect(s.winRate).toBeCloseTo(0.6);
    expect(s.winCI!.lo).toBeLessThan(0.6);
    expect(equityCurve(DAYS).map((p) => p.cum)).toEqual([150, -150, 50, -450, -350]);
  });

  it("finds missing statements from the NLV history", () => {
    expect(continuityGaps(DAYS)).toEqual([{ after: "2026-09-23", before: "2026-09-24" }]);
  });
});

describe("products", () => {
  it("groups per instrument with per-contract P/L, share and mapping proof", () => {
    const rows = productStats(DAYS);
    const mes = rows.find((r) => r.key === "MES")!;
    expect(mes).toMatchObject({
      days: 4,
      net: -620,
      contracts: 70,
      roundTurns: 35,
      perContract: -17.71,
      winDays: 2,
      mappingOk: true,
    });
    const zn = rows.find((r) => r.key === "ZN")!;
    expect(zn).toMatchObject({ days: 2, net: 250, mappingOk: true });
    expect(rows.find((r) => r.key === "code XX")).toMatchObject({ symbol: null, mappingOk: null });
    expect(rows[0].key).toBe("ZN"); // best first
  });

  it("flags a mapping whose multiplier is wrong (e.g. micro mapped to the full contract)", () => {
    const wrong = [day("2026-09-21", [prod("MES", 100, 2, { impliedMultiplier: 50 })])];
    expect(productStats(wrong)[0].mappingOk).toBe(false);
  });
});

describe("size lens", () => {
  it("splits days into volume terciles and measures the volume/P&L relation", () => {
    const b = sizeBuckets(DAYS);
    expect(b.map((x) => x.n).reduce((a, c) => a + c, 0)).toBe(5);
    expect(b.at(-1)!.label).toMatch(/^Heavy/);
    expect(b.at(-1)!.net).toBeLessThan(0);
    expect(volumeCorrelation(DAYS)).toBeLessThan(0);
    expect(volumeCorrelation(DAYS.slice(0, 4))).toBeNull();
    expect(weekdayRows(DAYS).map((r) => r.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
});

describe("process lens", () => {
  it("groups broker P/L by the day's process data", () => {
    const ctx = new Map<string, DayContext>([
      [
        "2026-09-21",
        {
          prepDone: true,
          readiness: 4.3,
          rulesFollowed: 1,
          processGrade: "A",
          highImpactEvent: false,
        },
      ],
      [
        "2026-09-22",
        {
          prepDone: false,
          readiness: 2,
          rulesFollowed: 0.5,
          processGrade: "C",
          highImpactEvent: true,
        },
      ],
      [
        "2026-09-23",
        {
          prepDone: true,
          readiness: 3.5,
          rulesFollowed: 1,
          processGrade: "B",
          highImpactEvent: false,
        },
      ],
    ]);
    const groups = processLens(DAYS, ctx);
    const prep = groups.find((g) => g.dimension === "Prep")!;
    expect(prep.rows).toMatchObject([
      { label: "Prep done", n: 2, net: 350 },
      { label: "No prep", n: 3, net: -700 },
    ]);
    const rules = groups.find((g) => g.dimension === "Rules (debrief)")!;
    expect(rules.rows.map((r) => [r.label, r.n])).toEqual([
      ["All followed", 2],
      ["Some broken", 1],
    ]);
  });
});

describe("reconciliation", () => {
  it("matches broker product-days with journal gross P/L", () => {
    const trades = [
      // Mon: MES matches (two trades), ZN differs by a tick-ish amount.
      {
        id: "t1",
        tradingDay: "2026-09-21",
        instrumentId: "i-mes",
        symbol: "MES",
        grossPnl: 60,
        contracts: 1,
      },
      {
        id: "t2",
        tradingDay: "2026-09-21",
        instrumentId: "i-mes",
        symbol: "MES",
        grossPnl: 40.5,
        contracts: 1,
      },
      {
        id: "t3",
        tradingDay: "2026-09-21",
        instrumentId: "i-zn",
        symbol: "ZN",
        grossPnl: 65.63,
        contracts: 1,
      },
      // Tue: an ES trade the broker never saw (other account?).
      {
        id: "t4",
        tradingDay: "2026-09-22",
        instrumentId: "i-es",
        symbol: "ES",
        grossPnl: 125,
        contracts: 1,
      },
      // A day without a statement is ignored.
      {
        id: "t5",
        tradingDay: "2026-09-18",
        instrumentId: "i-mes",
        symbol: "MES",
        grossPnl: 5,
        contracts: 1,
      },
    ];
    const rows = reconcile(DAYS, trades);
    const find = (date: string, key: string) => rows.find((r) => r.date === date && r.key === key)!;
    expect(find("2026-09-21", "MES")).toMatchObject({
      status: "matched",
      broker: 100,
      journal: 100.5,
      journalTrades: ["t1", "t2"],
    });
    expect(find("2026-09-21", "ZN")).toMatchObject({ status: "differs", diff: 15.63 });
    expect(find("2026-09-22", "MES")).toMatchObject({ status: "missing", journal: null });
    expect(find("2026-09-22", "ES")).toMatchObject({ status: "extra", broker: null, diff: 125 });
    expect(find("2026-09-25", "code XX")).toMatchObject({ status: "unmapped" });
    expect(rows.some((r) => r.date === "2026-09-18")).toBe(false);

    expect(
      verifyTrades(
        [
          { id: "t1", date: "2026-09-21", symbol: "MES" },
          { id: "t3", date: "2026-09-21", symbol: "ZN" },
          { id: "t5", date: "2026-09-18", symbol: "MES" },
        ],
        rows,
      ),
    ).toEqual({ total: 3, covered: 2, verified: 1 });

    const s = reconSummary(rows);
    expect(s).toMatchObject({
      total: 7,
      matched: 1,
      differs: 1,
      missing: 4,
      unmapped: 1,
      extra: 1,
    });
    expect(s.completeness).toBeCloseTo(1 / 7);
  });
});
