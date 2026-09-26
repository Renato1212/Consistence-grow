import { describe, expect, it } from "vitest";

import { diffLines, diffSnapshots } from "./diff";
import { canSavePlaybook, emptyPlaybook, moveItem, toPlaybookPayload } from "./form";
import { eventBucket, exampleOrder, playbookStats, type PlaybookTrade } from "./stats";

let seq = 0;
const t = (over: Partial<PlaybookTrade>): PlaybookTrade => ({
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
  playbook_name: "PB",
  grade_process: null,
  playbook_version: 1,
  time_bucket: "14:30",
  minutes_from_event: null,
  checklist: {},
  media_count: 0,
  ...over,
});

describe("playbook stats", () => {
  const trades = [
    t({
      r_multiple: 2,
      net_pnl: 200,
      grade_process: "A",
      minutes_from_event: 3,
      checklist: { a: true, b: true },
      media_count: 1,
    }),
    t({
      r_multiple: -1,
      net_pnl: -100,
      grade_process: "C",
      minutes_from_event: -10,
      checklist: { a: true, b: false },
    }),
    t({
      r_multiple: 0.5,
      net_pnl: 50,
      grade_process: "B",
      symbol: "NQ",
      time_bucket: "15:00",
      media_count: 2,
    }),
    t({ r_multiple: -3.5, net_pnl: -350, grade_process: "F", media_count: 1 }),
    t({ kind: "missed", r_multiple: 4, net_pnl: 400 }),
  ];
  const s = playbookStats(trades);

  it("computes expectancy and profit factor in R over taken trades only", () => {
    expect(s.n).toBe(4);
    expect(s.avgR).toBe(-0.5);
    expect(s.profitFactor).toBeCloseTo(2.5 / 4.5, 2);
    expect(s.winRate).toBeCloseTo(0.5);
  });

  it("bins R, buckets event proximity and grades", () => {
    expect(s.histogram.map((h) => h.n)).toEqual([1, 0, 1, 1, 0, 1, 0]);
    expect(s.byEvent.map((b) => [b.key, b.n])).toEqual([
      ["−30…0 min", 1],
      ["0–5 min", 1],
      ["No event", 2],
    ]);
    expect(s.byInstrument[0]).toMatchObject({ key: "ES", n: 3 });
    expect(s.grades).toEqual([
      { grade: "A", n: 1 },
      { grade: "B", n: 1 },
      { grade: "C", n: 1 },
      { grade: "F", n: 1 },
    ]);
  });

  it("measures checklist adherence", () => {
    expect(s.checklist).toEqual({ n: 2, complete: 1, avgTicked: 0.75 });
  });

  it("orders examples A-process first, media only", () => {
    expect(exampleOrder(trades).map((x) => x.grade_process)).toEqual(["A", "B", "F"]);
  });

  it("buckets event minutes at the edges", () => {
    expect(eventBucket(-31)).toBe("< −30 min");
    expect(eventBucket(-30)).toBe("−30…0 min");
    expect(eventBucket(0)).toBe("0–5 min");
    expect(eventBucket(60)).toBe("> 60 min");
  });

  it("is empty-safe", () => {
    expect(playbookStats([])).toMatchObject({
      n: 0,
      avgR: null,
      profitFactor: null,
      lastTraded: null,
    });
  });
});

describe("version diff", () => {
  it("diffs lines with LCS", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
    expect(diffLines("", "x")).toEqual([{ type: "add", text: "x" }]);
  });

  it("reports only changed fields", () => {
    const changes = diffSnapshots(
      { name: "A", status: "idea", markets: ["ES"], checklist: ["one", "two"], edge_md: "x" },
      {
        name: "A",
        status: "testing",
        markets: ["ES", "NQ"],
        checklist: ["two", "one"],
        edge_md: "x",
      },
    );
    expect(changes).toEqual([
      { key: "status", label: "Status", kind: "scalar", before: "idea", after: "testing" },
      { key: "markets", label: "Markets", kind: "list", added: ["NQ"], removed: [] },
      {
        key: "checklist",
        label: "Pre-entry checklist (reordered)",
        kind: "list",
        added: [],
        removed: [],
      },
    ]);
  });
});

describe("playbook form", () => {
  it("requires a name and drops the primary domain from secondaries", () => {
    const p = { ...emptyPlaybook("id", "FLOW"), secondaryDomains: ["FLOW", "DATA"] as const };
    expect(canSavePlaybook({ ...p, secondaryDomains: [...p.secondaryDomains] })).toBe(false);
    const payload = toPlaybookPayload({
      ...p,
      name: " Fix ",
      secondaryDomains: ["FLOW", "DATA"],
      checklist: [{ id: "c", text: " x " }],
    });
    expect(payload).toMatchObject({
      name: "Fix",
      secondary_domains: ["DATA"],
      checklist: [{ id: "c", text: "x" }],
    });
  });

  it("moves checklist items", () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
