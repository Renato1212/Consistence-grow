import { describe, expect, it } from "vitest";

import { draftsFromGroups, moveFill, restoreDraft, toPayload, type DraftTrade } from "./builder";
import type { SplitFill } from "./split";

const fills: SplitFill[] = [
  { id: "b1", side: "buy", qty: 4, price: 100 },
  { id: "s1", side: "sell", qty: 1, price: 101 },
  { id: "s2", side: "sell", qty: 3, price: 99 },
];

const one = (): DraftTrade[] =>
  draftsFromGroups([
    [
      { fillId: "b1", qty: 4 },
      { fillId: "s1", qty: 1 },
      { fillId: "s2", qty: 3 },
    ],
  ]);

describe("moveFill", () => {
  it("splits part of a fill into a new trade and back", () => {
    const d = one();
    const a = moveFill(d, "b1", d[0].key, "new", 1);
    expect(a).toHaveLength(2);
    expect(a[0].allocations.find((x) => x.fillId === "b1")?.qty).toBe(3);
    expect(a[1].allocations).toEqual([{ fillId: "b1", qty: 1 }]);
    const b = moveFill(a, "s1", a[0].key, a[1].key, 5); // capped at what is there
    expect(b[1].allocations).toEqual([
      { fillId: "b1", qty: 1 },
      { fillId: "s1", qty: 1 },
    ]);
    const c = moveFill(b, "b1", b[1].key, b[0].key, 1);
    expect(c[0].allocations.find((x) => x.fillId === "b1")?.qty).toBe(4);
    expect(c[1].allocations).toEqual([{ fillId: "s1", qty: 1 }]);
  });

  it("removes empty trades, drops journal links on change, and handles the pool", () => {
    const d = one().map((t) => ({ ...t, linkTradeId: "j1" }));
    const out = moveFill(d, "s1", d[0].key, null, 1);
    expect(out[0].linkTradeId).toBeNull();
    const back = moveFill(out, "s1", null, out[0].key, 1);
    expect(back[0].allocations.find((x) => x.fillId === "s1")?.qty).toBe(1);
    const all = back[0].allocations.reduce(
      (acc, a) => moveFill(acc, a.fillId, acc[0]?.key ?? null, null, a.qty),
      back,
    );
    expect(all).toEqual([]);
    expect(moveFill(d, "zz", d[0].key, "new", 1)).toBe(d);
  });
});

describe("toPayload", () => {
  it("needs a direction and valid times; converts Lisbon times to UTC", () => {
    const d = one();
    const missing = toPayload(d, "2026-09-28");
    expect(missing.ok).toBe(false);
    d[0].direction = "long";
    d[0].entry = "15:35";
    d[0].exit = "15:50";
    const ok = toPayload(d, "2026-09-28");
    expect(ok).toEqual({
      ok: true,
      trades: [
        {
          direction: "long",
          entry_at: "2026-09-28T14:35:00.000Z",
          exit_at: "2026-09-28T14:50:00.000Z",
          allocations: [
            { fill_id: "b1", qty: 4 },
            { fill_id: "s1", qty: 1 },
            { fill_id: "s2", qty: 3 },
          ],
        },
      ],
    });
    d[0].exit = "15:00";
    expect(toPayload(d, "2026-09-28").ok).toBe(false);
    d[0].exit = "";
    d[0].entry = "9:5";
    expect(toPayload(d, "2026-09-28").ok).toBe(false);
    d[0].entry = "";
    const noTimes = toPayload(d, "2026-09-28");
    expect(noTimes.ok && noTimes.trades[0].entry_at).toBeUndefined();
  });
});

describe("restoreDraft", () => {
  it("restores a stored draft that fits the fills and rejects one that does not", () => {
    const stored = { v: 1, at: 1, mode: "manual", drafts: one() };
    expect(restoreDraft(JSON.stringify(stored), fills)?.drafts).toHaveLength(1);
    const over = structuredClone(stored);
    over.drafts[0].allocations[0].qty = 9;
    expect(restoreDraft(JSON.stringify(over), fills)).toBeNull();
    const unknown = structuredClone(stored);
    unknown.drafts[0].allocations[0].fillId = "gone";
    expect(restoreDraft(JSON.stringify(unknown), fills)).toBeNull();
    expect(restoreDraft("{nope", fills)).toBeNull();
    expect(restoreDraft(null, fills)).toBeNull();
  });
});
