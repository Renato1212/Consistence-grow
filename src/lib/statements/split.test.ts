import { describe, expect, it } from "vitest";

import {
  checkSplit,
  entryExit,
  finestSplit,
  groupMath,
  isUnambiguous,
  matchJournal,
  oneTrade,
  splitInto,
  suggestSplits,
  type Group,
  type SplitFill,
} from "./split";

const MES = { tickSize: 0.25, tickValue: 1.25 };
const ZN = { tickSize: 0.015625, tickValue: 15.625 };

let seq = 0;
const f = (side: "buy" | "sell", qty: number, price: number): SplitFill => ({
  id: `f${++seq}`,
  side,
  qty,
  price,
});

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Print fills like Axia: buys then sells, each sorted by price. */
const axiaOrder = (fills: SplitFill[]) =>
  [...fills].sort((a, b) => (a.side !== b.side ? (a.side === "buy" ? -1 : 1) : a.price - b.price));

describe("groupMath", () => {
  it("computes averages, contracts and gross P/L independent of direction", () => {
    const fills = [f("buy", 5, 7755.25), f("buy", 5, 7757.25), f("sell", 10, 7760)];
    const byId = new Map(fills.map((x) => [x.id, x]));
    const m = groupMath(
      fills.map((x) => ({ fillId: x.id, qty: x.qty })),
      byId,
      MES,
    );
    expect(m).toMatchObject({ buyQty: 10, sellQty: 10, balanced: true, contracts: 10 });
    expect(m.avgBuy).toBeCloseTo(7756.25, 10);
    expect(m.gross).toBe(187.5); // 3.75 points × $5 × 10
    expect(entryExit(m, "long")).toEqual({ entry: m.avgBuy, exit: m.avgSell });
    expect(entryExit(m, "short")).toEqual({ entry: m.avgSell, exit: m.avgBuy });
  });

  it("handles partial allocations of a fill", () => {
    const a = f("buy", 10, 104.5);
    const b = f("sell", 4, 104.53125);
    const byId = new Map([a, b].map((x) => [x.id, x]));
    const m = groupMath(
      [
        { fillId: a.id, qty: 4 },
        { fillId: b.id, qty: 4 },
      ],
      byId,
      ZN,
    );
    expect(m.gross).toBe(125); // 2 ticks × 15.625 × 4
  });
});

describe("checkSplit", () => {
  const fills = [f("buy", 3, 4161.2), f("sell", 2, 4170.5), f("sell", 1, 4170.6)];
  const spec = { tickSize: 0.1, tickValue: 1 };

  it("accepts a complete flat split that adds up to the broker", () => {
    const c = checkSplit(fills, oneTrade(fills), spec, 280);
    expect(c.ok).toBe(true);
    expect(c.total).toBe(280);
  });

  it("reports unallocated, over-allocated, unbalanced and total mismatches", () => {
    const [b, s1, s2] = fills;
    const partial = checkSplit(
      fills,
      [
        [
          { fillId: b.id, qty: 3 },
          { fillId: s1.id, qty: 2 },
        ],
      ],
      spec,
      280,
    );
    expect(partial.ok).toBe(false);
    expect(partial.issues.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["unallocated", "unbalanced"]),
    );
    expect(partial.remaining.get(s2.id)).toBe(1);
    const over = checkSplit(fills, [...oneTrade(fills), [{ fillId: s2.id, qty: 1 }]], spec, 280);
    expect(over.issues.map((i) => i.kind)).toContain("over-allocated");
    const wrong = checkSplit(fills, oneTrade(fills), spec, 250);
    expect(wrong.issues).toEqual([{ kind: "total", expected: 250, actual: 280 }]);
  });

  it("allows the broker's per-fill cent rounding on 32nds prices", () => {
    const zn = [f("buy", 6, 104.359375), f("buy", 5, 104.453125), f("sell", 11, 104.46875)];
    const exact = checkSplit(zn, oneTrade(zn), ZN, null).total;
    expect(checkSplit(zn, oneTrade(zn), ZN, exact - 0.015).ok).toBe(true);
    expect(checkSplit(zn, oneTrade(zn), ZN, exact - 0.5).ok).toBe(false);
  });

  it("flags a product that is not flat", () => {
    const c = checkSplit([f("buy", 2, 10), f("sell", 1, 11)], [], MES, null);
    expect(c.issues[0]).toEqual({ kind: "not-flat", bought: 2, sold: 1 });
  });
});

describe("finestSplit", () => {
  it("splits into the most flat trades, grouping fills close in price", () => {
    // Two trades: long 5 @100 → 102, short 5 @110 → 108 (sizes equal, so price decides).
    const fills = axiaOrder([
      f("buy", 5, 100),
      f("sell", 5, 102),
      f("sell", 5, 110),
      f("buy", 5, 108),
    ]);
    const s = finestSplit(fills)!;
    expect(s.exact).toBe(true);
    expect(s.groups).toHaveLength(2);
    const byId = new Map(fills.map((x) => [x.id, x]));
    const prices = s.groups.map((g) => g.map((a) => byId.get(a.fillId)!.price).sort());
    expect(prices).toEqual([
      [100, 102],
      [108, 110],
    ]);
  });

  it("keeps scale-ins and scale-outs together when no smaller flat group exists", () => {
    const fills = [f("buy", 3, 4161.2), f("sell", 2, 4170.5), f("sell", 1, 4170.6)];
    const s = finestSplit(fills)!;
    expect(s.groups).toHaveLength(1);
    expect(isUnambiguous(fills)).toBe(true);
  });

  it("returns null when the product is not flat", () => {
    expect(finestSplit([f("buy", 2, 1), f("sell", 1, 1)])).toBeNull();
    expect(suggestSplits([f("buy", 2, 1), f("sell", 1, 1)])).toEqual([]);
  });

  it("stays fast and exact on a busy 18-fill day", () => {
    const qty = [5, 15, 20, 5, 5, 20, 60];
    const sells = [15, 10, 5, 15, 5, 10, 20, 30, 10, 5, 5];
    const fills = [
      ...qty.map((q, i) => f("buy", q, 7755 + i)),
      ...sells.map((q, i) => f("sell", q, 7756 + i)),
    ];
    const t0 = performance.now();
    const s = finestSplit(fills)!;
    const ms = performance.now() - t0;
    expect(s.exact).toBe(true);
    expect(s.groups).toHaveLength(7);
    expect(checkSplit(fills, s.groups, MES, null).ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  });

  it("falls back to a greedy split beyond the exact limit and stays valid", () => {
    const rand = rng(3);
    const fills: SplitFill[] = [];
    for (let i = 0; i < 20; i++) {
      const q = 1 + Math.floor(rand() * 4);
      const p = 5000 + Math.floor(rand() * 40) * 0.25;
      fills.push(f("buy", q, p), f("sell", q, p + 0.25 * Math.floor(rand() * 8)));
    }
    const s = finestSplit(axiaOrder(fills))!;
    expect(s.exact).toBe(false);
    expect(s.groups.length).toBeGreaterThan(5);
    expect(checkSplit(fills, s.groups, MES, null).ok).toBe(true);
  });
});

describe("suggestions", () => {
  it("offers the finest split and one trade, and merges down to k trades", () => {
    const fills = axiaOrder([
      f("buy", 2, 100),
      f("sell", 2, 101),
      f("buy", 3, 105),
      f("sell", 3, 104),
      f("buy", 1, 110),
      f("sell", 1, 112),
    ]);
    const s = suggestSplits(fills);
    expect(s.map((x) => x.id)).toEqual(["finest", "one"]);
    expect(s[0].groups).toHaveLength(3);
    for (const k of [1, 2, 3]) {
      const g = splitInto(fills, k);
      expect(g).toHaveLength(k);
      expect(checkSplit(fills, g, MES, null).ok).toBe(true);
    }
  });
});

describe("property: random days built from known trades", () => {
  it("every suggestion is valid, adds up, and the true split is never finer than the finest", () => {
    const rand = rng(42);
    for (let day = 0; day < 300; day++) {
      const trades: Group[] = [];
      const fills: SplitFill[] = [];
      let truth = 0;
      const nTrades = 1 + Math.floor(rand() * 5);
      let px = 5000 + Math.floor(rand() * 400) * 0.25;
      for (let t = 0; t < nTrades; t++) {
        const long = rand() < 0.5;
        const size = 1 + Math.floor(rand() * 6);
        // Scale in (1–2 fills) and out (1–3 fills).
        const cut = (n: number, parts: number) => {
          const out: number[] = [];
          let left = n;
          for (let i = 1; i < parts && left > 1; i++) {
            const q = 1 + Math.floor(rand() * (left - 1));
            out.push(q);
            left -= q;
          }
          out.push(left);
          return out;
        };
        const ins = cut(size, 1 + Math.floor(rand() * 2));
        const outs = cut(size, 1 + Math.floor(rand() * 3));
        const group: Group = [];
        let val = 0;
        for (const q of ins) {
          const x = f(long ? "buy" : "sell", q, px + Math.floor(rand() * 3) * 0.25);
          fills.push(x);
          group.push({ fillId: x.id, qty: q });
          val += (long ? -1 : 1) * q * x.price;
        }
        px += (Math.floor(rand() * 17) - 8) * 0.25;
        for (const q of outs) {
          const x = f(long ? "sell" : "buy", q, px + Math.floor(rand() * 3) * 0.25);
          fills.push(x);
          group.push({ fillId: x.id, qty: q });
          val += (long ? 1 : -1) * q * x.price;
        }
        truth += val * 5;
        trades.push(group);
      }
      const printed = axiaOrder(fills);
      const realized = Math.round(truth * 100) / 100;
      const trueCheck = checkSplit(printed, trades, MES, realized);
      expect(trueCheck.ok, `day ${day} truth`).toBe(true);
      const suggestions = suggestSplits(printed);
      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        const c = checkSplit(printed, s.groups, MES, realized);
        expect(c.ok, `day ${day} ${s.id}`).toBe(true);
      }
      const finest = finestSplit(printed)!;
      if (finest.exact) expect(finest.groups.length).toBeGreaterThanOrEqual(trades.length);
    }
  });
});

describe("matchJournal", () => {
  const fills = axiaOrder([
    f("buy", 2, 100),
    f("buy", 3, 105),
    f("sell", 2, 101),
    f("sell", 1, 103),
    f("sell", 2, 104),
  ]);
  const spec = { tickSize: 0.25, tickValue: 1.25 };

  it("links hand-typed trades by contracts and average prices", () => {
    const m = matchJournal(
      fills,
      [
        { id: "a", direction: "long", contracts: 2, entryPrice: 100, exitPrice: 101 },
        { id: "b", direction: "short", contracts: 3, entryPrice: 103.67, exitPrice: 105 },
      ],
      spec,
    )!;
    expect(m.method).toBe("prices");
    const c = checkSplit(
      fills,
      m.trades.map((t) => t.allocations),
      spec,
      null,
    );
    expect(c.ok).toBe(true);
    expect(c.groups.map((g) => g.contracts)).toEqual([2, 3]);
  });

  it("links imported trades by their platform fills, splitting a statement fill", () => {
    const one = [f("buy", 4, 50), f("sell", 1, 51), f("sell", 3, 49)];
    const m = matchJournal(
      one,
      [
        {
          id: "x",
          direction: "long",
          contracts: 1,
          entryPrice: 50,
          exitPrice: 51,
          fills: [
            { side: "buy", qty: 1, price: 50 },
            { side: "sell", qty: 1, price: 51 },
          ],
        },
        {
          id: "y",
          direction: "long",
          contracts: 3,
          entryPrice: 50,
          exitPrice: 49,
          fills: [
            { side: "buy", qty: 3, price: 50 },
            { side: "sell", qty: 3, price: 49 },
          ],
        },
      ],
      spec,
    )!;
    expect(m.method).toBe("fills");
    expect(m.trades[0].allocations).toEqual([
      { fillId: one[0].id, qty: 1 },
      { fillId: one[1].id, qty: 1 },
    ]);
    expect(
      checkSplit(
        one,
        m.trades.map((t) => t.allocations),
        spec,
        null,
      ).ok,
    ).toBe(true);
  });

  it("returns null when the journal does not add up to the broker fills", () => {
    expect(
      matchJournal(
        fills,
        [{ id: "a", direction: "long", contracts: 4, entryPrice: 100, exitPrice: 101 }],
        spec,
      ),
    ).toBeNull();
    expect(
      matchJournal(
        fills,
        [
          { id: "a", direction: "long", contracts: 2, entryPrice: 100, exitPrice: 102 },
          { id: "b", direction: "short", contracts: 3, entryPrice: 103.67, exitPrice: 105 },
        ],
        spec,
      ),
    ).toBeNull();
  });
});
