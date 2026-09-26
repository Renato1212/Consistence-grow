import { describe, expect, it } from "vitest";

import { isoWeekKey, isoWeekOf, isoWeekStart, parseIsoWeekKey } from "@/lib/calendar/dates";
import {
  breakdown,
  equityCurve,
  extremes,
  sampleQuality,
  summarize,
  type FactTrade,
} from "./stats";

let seq = 0;
const t = (over: Partial<FactTrade>): FactTrade => ({
  id: `t${++seq}`,
  kind: "taken",
  trade_date: "2026-09-28",
  entry_at: `2026-09-28T13:${String(seq).padStart(2, "0")}:00Z`,
  symbol: "ES",
  direction: "long",
  net_pnl: 0,
  r_multiple: null,
  currency: "USD",
  primary_domain: "TECHNICAL",
  playbook_name: null,
  grade_process: null,
  ...over,
});

describe("ISO weeks", () => {
  it("matches ISO-8601 across year boundaries", () => {
    expect(isoWeekOf("2026-09-28")).toEqual({ year: 2026, week: 40 });
    expect(isoWeekOf("2027-01-01")).toEqual({ year: 2026, week: 53 }); // Friday, 2026 has 53 weeks
    expect(isoWeekOf("2025-12-29")).toEqual({ year: 2026, week: 1 });
    expect(isoWeekOf("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeekStart(2026, 1)).toBe("2025-12-29");
    expect(isoWeekStart(2026, 40)).toBe("2026-09-28");
    expect(isoWeekKey(2026, 5)).toBe("2026-W05");
  });

  it("parses keys and rejects impossible weeks", () => {
    expect(parseIsoWeekKey("2026-W53")).toEqual({ year: 2026, week: 53 });
    expect(parseIsoWeekKey("2025-W53")).toBeNull(); // 2025 has 52 weeks
    expect(parseIsoWeekKey("2026-40")).toBeNull();
  });
});

describe("summarize", () => {
  it("counts only taken trades, R only where a stop existed, currencies apart", () => {
    const s = summarize([
      t({ net_pnl: 250, r_multiple: 2 }),
      t({ net_pnl: -125, r_multiple: -1 }),
      t({ net_pnl: 80, r_multiple: null }),
      t({ net_pnl: 40, currency: "EUR", r_multiple: 0.5 }),
      t({ kind: "missed", net_pnl: 999, r_multiple: 5 }),
      t({ kind: "observed", net_pnl: null }),
      t({ net_pnl: 0, r_multiple: 0 }),
    ]);
    expect(s).toMatchObject({
      n: 5,
      wins: 3,
      losses: 1,
      netR: 1.5,
      rN: 4,
      byCurrency: { USD: 205, EUR: 40 },
    });
    expect(s.winRate).toBeCloseTo(0.75);
    expect(s.best!.r_multiple).toBe(2);
    expect(s.worst!.r_multiple).toBe(-1);
  });

  it("is empty-safe", () => {
    expect(summarize([])).toMatchObject({ n: 0, winRate: null, best: null, netR: 0 });
  });
});

describe("week views", () => {
  const trades = [
    t({
      id: "a",
      r_multiple: 1,
      primary_domain: "DATA",
      playbook_name: "CPI fade",
      grade_process: "A",
      entry_at: "2026-09-28T13:00:00Z",
    }),
    t({
      id: "b",
      r_multiple: -1,
      primary_domain: "DATA",
      grade_process: "C",
      entry_at: "2026-09-29T13:00:00Z",
    }),
    t({
      id: "c",
      r_multiple: 3,
      primary_domain: "FLOW",
      playbook_name: "Fix",
      grade_process: "B",
      entry_at: "2026-09-30T13:00:00Z",
    }),
    t({
      id: "d",
      r_multiple: null,
      primary_domain: "FLOW",
      grade_process: "F",
      entry_at: "2026-10-01T13:00:00Z",
    }),
    t({ id: "m", kind: "missed", r_multiple: 4, entry_at: "2026-10-01T14:00:00Z" }),
  ];

  it("builds a cumulative R curve in entry order", () => {
    expect(equityCurve(trades).map((p) => p.cum)).toEqual([1, 0, 3]);
  });

  it("breaks down by domain and playbook", () => {
    expect(breakdown(trades, (x) => x.primary_domain)).toEqual([
      { key: "FLOW", n: 2, netR: 3, rN: 1, winRate: null },
      { key: "DATA", n: 2, netR: 0, rN: 2, winRate: null },
    ]);
    expect(breakdown(trades, (x) => x.playbook_name, "No playbook").map((r) => r.key)).toEqual([
      "Fix",
      "CPI fade",
      "No playbook",
    ]);
  });

  it("picks top/bottom trades without overlap when there are few", () => {
    const e = extremes(trades);
    expect(e.topR.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(e.bottomR).toEqual([]); // only 3 trades with R: all already on top
    expect(e.topProcess.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(e.bottomProcess.map((x) => x.id)).toEqual(["d"]);
  });

  it("labels sample quality", () => {
    expect(sampleQuality(5)).toBe("weak");
    expect(sampleQuality(15)).toBe("insufficient");
    expect(sampleQuality(25)).toBe("ok");
  });
});
