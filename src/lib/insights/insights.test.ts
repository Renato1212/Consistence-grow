import { describe, expect, it } from "vitest";

import {
  breakdownBy,
  domainPairs,
  findPatterns,
  levelRespect,
  mistakeCosts,
  moveProfile,
  planAlignment,
  processMatrix,
  ruleViolationsByWeek,
  scenarioOutcomes,
  timeWeekdayHeatmap,
} from "./analysis";
import { readinessBand } from "./dimensions";
import {
  applyFilter,
  dateBounds,
  DEFAULT_FILTER,
  filterChips,
  filterToQuery,
  normalizeFilter,
  parseFilter,
  withValue,
  type Filter,
} from "./filters";
import {
  bootstrapMean,
  computeMetrics,
  equitySeries,
  maxDrawdown,
  median,
  mulberry32,
  rHistogram,
  streaks,
  wilson,
} from "./metrics";
import type { InsightTrade } from "./types";

let seq = 0;
function trade(p: Partial<InsightTrade> = {}): InsightTrade {
  seq++;
  const r = p.r_multiple === undefined ? 1 : p.r_multiple;
  return {
    id: p.id ?? `t${seq}`,
    kind: "taken",
    trade_date: "2026-09-21",
    entry_at: `2026-09-21T09:${String(seq % 60).padStart(2, "0")}:00Z`,
    symbol: "ES",
    currency: "USD",
    direction: "long",
    net_pnl: r === null ? 50 : r * 100,
    r_multiple: r,
    ticks: 8,
    duration_sec: 300,
    session: "US",
    weekday: 1,
    time_bucket: "09:30",
    primary_domain: "DATA",
    secondary_domains: [],
    domain_count: 1,
    playbook_id: null,
    playbook_name: null,
    playbook_version: null,
    minutes_from_event: null,
    event_category: null,
    event_title: null,
    level_type: null,
    level_strength: null,
    scenario_id: null,
    key_level_id: null,
    regime: null,
    prior_day_type: null,
    prep_done: null,
    readiness: null,
    confidence: null,
    grade_context: null,
    grade_edge: null,
    grade_process: null,
    exit_reason: null,
    tag_ids: [],
    tag_names: [],
    ...p,
  };
}

function params(q: string) {
  return new URLSearchParams(q);
}

describe("statistics", () => {
  it("wilson interval matches the textbook value", () => {
    const ci = wilson(7, 10)!;
    expect(ci.lo).toBeCloseTo(0.3968, 3);
    expect(ci.hi).toBeCloseTo(0.8922, 3);
    expect(wilson(0, 0)).toBeNull();
    const zero = wilson(0, 5)!;
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeCloseTo(0.4345, 3);
  });

  it("bootstrap is seeded, brackets the mean and needs n ≥ 2", () => {
    const v = [1, -1, 2, -1, 0.5, 3, -1, 1.5];
    const a = bootstrapMean(v)!;
    const b = bootstrapMean(v)!;
    expect(a).toEqual(b);
    const m = v.reduce((x, y) => x + y) / v.length;
    expect(a.lo).toBeLessThan(m);
    expect(a.hi).toBeGreaterThan(m);
    expect(bootstrapMean([1])).toBeNull();
    expect(bootstrapMean([2, 2, 2])).toEqual({ lo: 2, hi: 2 });
  });

  it("prng is deterministic in [0,1)", () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = r1();
      expect(x).toBe(r2());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("drawdown, streaks and median", () => {
    expect(maxDrawdown([1, -2, 1, -1, 3])).toBe(-2);
    expect(maxDrawdown([1, 2])).toBe(0);
    expect(maxDrawdown([-1, -1])).toBe(-2);
    expect(streaks([1, 1, -1, -1, -1, 0, 1])).toEqual({ win: 2, loss: 3 });
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes the full metric set honestly", () => {
    const ts = [
      trade({ r_multiple: 2, entry_at: "2026-09-01T10:00:00Z" }),
      trade({ r_multiple: -1, entry_at: "2026-09-02T10:00:00Z" }),
      trade({ r_multiple: -1, entry_at: "2026-09-03T10:00:00Z" }),
      trade({ r_multiple: 3, entry_at: "2026-09-04T10:00:00Z" }),
      // no stop: counts for win rate and money, not for R
      trade({ r_multiple: null, net_pnl: 40, entry_at: "2026-09-05T10:00:00Z" }),
      trade({ r_multiple: -0.5, currency: "EUR", entry_at: "2026-09-06T10:00:00Z" }),
    ];
    const m = computeMetrics(ts);
    expect(m.n).toBe(6);
    expect(m.rN).toBe(5);
    expect(m.wins).toBe(3);
    expect(m.losses).toBe(3);
    expect(m.winRate).toBe(0.5);
    expect(m.netR).toBe(2.5);
    expect(m.expectancy).toBe(0.5);
    expect(m.avgWinR).toBe(2.5);
    expect(m.avgLossR).toBe(-0.83);
    expect(m.profitFactor).toBe(2);
    expect(m.maxDrawdownR).toBe(-2);
    expect(m.byCurrency).toEqual({ USD: 340, EUR: -50 });
    expect(m.maxDrawdown).toEqual({ USD: -200, EUR: -50 });
    expect(m.longestWin).toBe(2);
    expect(m.longestLoss).toBe(2);
    expect(m.expCI).not.toBeNull();
    expect(computeMetrics(ts, { withCI: false }).expCI).toBeNull();
  });

  it("empty and no-stop sets never invent numbers", () => {
    const e = computeMetrics([]);
    expect(e.n).toBe(0);
    expect(e.winRate).toBeNull();
    expect(e.expectancy).toBeNull();
    expect(e.profitFactor).toBeNull();
    const noStop = computeMetrics([trade({ r_multiple: null }), trade({ r_multiple: null })]);
    expect(noStop.rN).toBe(0);
    expect(noStop.expectancy).toBeNull();
    expect(noStop.winRate).toBe(1);
  });

  it("equity series per unit, histogram bins", () => {
    const ts = [
      trade({ r_multiple: 1, entry_at: "2026-09-02T10:00:00Z" }),
      trade({ r_multiple: -2.5, entry_at: "2026-09-01T10:00:00Z" }),
      trade({ r_multiple: null, entry_at: "2026-09-03T10:00:00Z", net_pnl: 10, currency: "EUR" }),
    ];
    expect(equitySeries(ts, "R").map((p) => p.cum)).toEqual([-2.5, -1.5]);
    expect(equitySeries(ts, "EUR").map((p) => p.cum)).toEqual([10]);
    const h = rHistogram(ts);
    expect(h.find((b) => b.label === "≤ −2R")!.ids).toHaveLength(1);
    expect(h.find((b) => b.label === "1…2")!.ids).toHaveLength(1);
    expect(h.reduce((a, b) => a + b.ids.length, 0)).toBe(2);
  });
});

describe("filters", () => {
  it("round-trips through the URL and drops junk", () => {
    const f: Filter = {
      ...DEFAULT_FILTER,
      range: "custom",
      from: "2026-01-01",
      to: "2026-06-30",
      kinds: ["taken", "missed"],
      values: { domain: ["DATA", "NEWS"], tag: ["A+ setup", "late, chased"], playbook: ["ORB"] },
      tagMode: "all",
      playbookVersion: 2,
      readinessMin: 3,
      readinessMax: null,
    };
    const q = filterToQuery(f).toString();
    expect(parseFilter(params(q))).toEqual(f);
    expect(filterToQuery(DEFAULT_FILTER).toString()).toBe("");
    const junk = parseFilter(params("range=forever&kind=bogus&from=x&pbv=2&rmin=abc&dom=DATA"));
    expect(junk.range).toBe("all");
    expect(junk.kinds).toEqual(["taken"]);
    expect(junk.playbookVersion).toBeNull(); // needs exactly one playbook
    expect(junk.readinessMin).toBeNull();
    expect(junk.values).toEqual({ domain: ["DATA"] });
  });

  it("normalizes stored views safely", () => {
    expect(normalizeFilter(null)).toEqual(DEFAULT_FILTER);
    const n = normalizeFilter({ range: "90d", values: { domain: ["DATA"], nope: ["x"], tag: [] } });
    expect(n.range).toBe("90d");
    expect(n.values).toEqual({ domain: ["DATA"] });
    expect(n.kinds).toEqual(["taken"]);
  });

  it("resolves date ranges against the Lisbon date", () => {
    const f = (range: Filter["range"]) => ({ ...DEFAULT_FILTER, range });
    expect(dateBounds(f("30d"), "2026-09-26")).toEqual({ from: "2026-08-28", to: "2026-09-26" });
    expect(dateBounds(f("ytd"), "2026-09-26")).toEqual({ from: "2026-01-01", to: "2026-09-26" });
    expect(dateBounds(f("all"), "2026-09-26")).toEqual({ from: null, to: null });
  });

  it("applies every kind of constraint", () => {
    const a = trade({ id: "a", tag_names: ["x", "y"], readiness: 4, trade_date: "2026-09-20" });
    const b = trade({ id: "b", tag_names: ["x"], primary_domain: "NEWS", readiness: 2 });
    const c = trade({ id: "c", kind: "missed", tag_names: [] });
    const d = trade({ id: "d", playbook_name: "ORB", playbook_version: 2, trade_date: null });
    const all = [a, b, c, d];
    const ids = (f: Partial<Filter>) =>
      applyFilter(all, { ...DEFAULT_FILTER, ...f }, "2026-09-26").map((t) => t.id);
    expect(ids({})).toEqual(["a", "b", "d"]);
    expect(ids({ kinds: ["missed"] })).toEqual(["c"]);
    expect(ids({ values: { tag: ["x", "y"] }, tagMode: "any" })).toEqual(["a", "b"]);
    expect(ids({ values: { tag: ["x", "y"] }, tagMode: "all" })).toEqual(["a"]);
    expect(ids({ values: { tag: ["y"] }, tagMode: "none" })).toEqual(["b", "d"]);
    expect(ids({ values: { domain: ["NEWS"] } })).toEqual(["b"]);
    expect(ids({ readinessMin: 3 })).toEqual(["a"]);
    expect(ids({ values: { playbook: ["ORB"] }, playbookVersion: 1 })).toEqual([]);
    expect(ids({ values: { playbook: ["ORB"] }, playbookVersion: 2 })).toEqual(["d"]);
    // Trades without a trading day never match a bounded range
    expect(ids({ range: "custom", from: "2026-09-21", to: null })).toEqual(["b"]);
  });

  it("chips remove exactly one constraint", () => {
    let f = withValue(DEFAULT_FILTER, "domain", "DATA");
    f = withValue(f, "domain", "NEWS");
    f = withValue(f, "playbook", "ORB");
    f = { ...f, playbookVersion: 3 };
    const chips = filterChips(f);
    expect(chips.map((c) => c.label)).toEqual([
      "Primary domain: Data",
      "Primary domain: News",
      "Playbook: ORB",
      "Playbook version: v3",
    ]);
    expect(chips[0].without.values.domain).toEqual(["NEWS"]);
    expect(chips[2].without.values.playbook).toBeUndefined();
    expect(chips[2].without.playbookVersion).toBeNull();
    expect(withValue(f, "domain", "DATA")).toBe(f);
  });
});

describe("breakdowns", () => {
  it("groups single- and multi-valued dimensions with fixed orders", () => {
    const ts = [
      trade({ weekday: 3, r_multiple: 1 }),
      trade({ weekday: 1, r_multiple: -1 }),
      trade({ weekday: 1, r_multiple: 2 }),
      trade({ weekday: null }),
    ];
    const rows = breakdownBy(ts, "weekday");
    expect(rows.map((r) => [r.label, r.m.n])).toEqual([
      ["Mon", 2],
      ["Wed", 1],
      ["Not set", 1],
    ]);
    expect(rows[0].m.expectancy).toBe(0.5);

    const tagged = [
      trade({ tag_names: ["a", "b"] }),
      trade({ tag_names: ["a"] }),
      trade({ tag_names: [] }),
    ];
    const tags = breakdownBy(tagged, "tag");
    expect(tags.map((r) => [r.key, r.ids.length])).toEqual([
      ["a", 2],
      ["b", 1],
      ["—", 1],
    ]);
  });

  it("buckets readiness, event proximity and confluence", () => {
    expect(readinessBand(null)).toBeNull();
    expect(readinessBand(2.49)).toBe("< 2.5");
    expect(readinessBand(3)).toBe("2.5–3.5");
    expect(readinessBand(3.5)).toBe("≥ 3.5");
    const ev = breakdownBy(
      [trade({ minutes_from_event: -10 }), trade({ minutes_from_event: 2 }), trade()],
      "event",
    );
    expect(ev.map((r) => r.key)).toEqual(["−30…0 min", "0–5 min", "No event"]);
    const dc = breakdownBy(
      [trade({ domain_count: 4 }), trade({ domain_count: 2 }), trade({ domain_count: 0 })],
      "domainCount",
    );
    expect(dc.map((r) => r.label)).toEqual(["2 domains", "3+ domains", "Not set"]);
  });

  it("time × weekday heatmap shows n and expectancy per cell", () => {
    const h = timeWeekdayHeatmap([
      trade({ weekday: 2, time_bucket: "09:30", r_multiple: 1 }),
      trade({ weekday: 2, time_bucket: "09:30", r_multiple: -2 }),
      trade({ weekday: 4, time_bucket: "08:00", r_multiple: null }),
    ]);
    expect(h.buckets).toEqual(["08:00", "09:30"]);
    expect(h.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(h.cells.get("2|09:30")).toMatchObject({ n: 2, rN: 2, exp: -0.5 });
    expect(h.cells.get("4|08:00")).toMatchObject({ n: 1, rN: 0, exp: null });
  });
});

describe("pattern finder", () => {
  function dataset() {
    const out: InsightTrade[] = [];
    // DATA + regime Trending: strong (+2R) ×8
    for (let i = 0; i < 8; i++)
      out.push(trade({ primary_domain: "DATA", regime: "Trending", weekday: 2, r_multiple: 2 }));
    // NEWS + regime Balancing: leak (−1R) ×8
    for (let i = 0; i < 8; i++)
      out.push(trade({ primary_domain: "NEWS", regime: "Balancing", weekday: 2, r_multiple: -1 }));
    // noise below the threshold
    for (let i = 0; i < 3; i++)
      out.push(trade({ primary_domain: "FLOW", regime: "Trending", weekday: 3, r_multiple: 5 }));
    return out;
  }

  it("respects min n, ranks by lift and labels both lists", () => {
    const res = findPatterns(dataset(), 8, { dims: ["domain", "regime", "weekday"] });
    expect(res.baseline.rN).toBe(19);
    const base = (16 - 8 + 15) / 19;
    expect(res.baseline.expectancy).toBeCloseTo(base, 2);
    expect(res.strongest[0].label).toBe("Primary domain: Data + Market regime: Trending");
    expect(res.strongest[0].n).toBe(8);
    expect(res.strongest[0].expectancy).toBe(2);
    expect(res.strongest[0].lift).toBeCloseTo(2 - base, 2);
    expect(res.strongest[0].winRate).toBe(1);
    expect(res.leaks[0].expectancy).toBe(-1);
    // Nothing built on the 3 FLOW trades
    expect([...res.strongest, ...res.leaks].some((p) => p.label.includes("Flow"))).toBe(false);
    // 3-combos identical to their 2-subsets are pruned
    expect(res.strongest.every((p) => p.conditions.length === 2)).toBe(true);
    const lower = findPatterns(dataset(), 3, { dims: ["domain", "regime", "weekday"] });
    expect(lower.strongest[0].label).toContain("Flow");
  });

  it("uses each tag separately and ignores trades without R", () => {
    const ts = [
      ...Array.from({ length: 4 }, () =>
        trade({ tag_names: ["a", "b"], primary_domain: "DATA", r_multiple: 1 }),
      ),
      ...Array.from({ length: 4 }, () =>
        trade({ tag_names: ["a"], primary_domain: "NEWS", r_multiple: -1 }),
      ),
      ...Array.from({ length: 4 }, () =>
        trade({ tag_names: ["b"], primary_domain: "NEWS", r_multiple: 0 }),
      ),
      trade({ tag_names: ["a"], primary_domain: "DATA", r_multiple: null }),
    ];
    const res = findPatterns(ts, 4, { dims: ["tag", "domain"] });
    expect(res.baseline.rN).toBe(12);
    expect(res.strongest.map((p) => p.label).sort()).toEqual([
      "Tag: a + Primary domain: Data",
      "Tag: b + Primary domain: Data",
    ]);
    expect(res.leaks.map((p) => p.label)).toEqual(["Tag: a + Primary domain: News"]);
    // "Tag: a + Tag: b" is not a combination (one value per dimension)
    const labels = [...res.strongest, ...res.leaks].map((p) => p.label);
    expect(labels.some((l) => l.includes("Tag: a + Tag: b"))).toBe(false);
  });

  it("leaves out attributes every trade shares", () => {
    const ts = [
      ...Array.from({ length: 5 }, () =>
        trade({ symbol: "ES", weekday: 2, confidence: 4, r_multiple: 2 }),
      ),
      ...Array.from({ length: 5 }, () =>
        trade({ symbol: "ES", weekday: 4, confidence: 2, r_multiple: -1 }),
      ),
    ];
    const res = findPatterns(ts, 5, { dims: ["instrument", "weekday", "confidence"] });
    expect(res.strongest.map((p) => p.label)).toEqual(["Weekday: Tue + Confidence: 4"]);
    expect(res.leaks.map((p) => p.label)).toEqual(["Weekday: Thu + Confidence: 2"]);
  });

  it("returns nothing without R", () => {
    const res = findPatterns([trade({ r_multiple: null })], 1);
    expect(res.strongest).toEqual([]);
    expect(res.baseline.expectancy).toBeNull();
  });

  it("mines 5,000 trades fast enough", () => {
    const rand = mulberry32(1);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const ts = Array.from({ length: 5000 }, () =>
      trade({
        primary_domain: pick(["DATA", "NEWS", "FLOW", "TECHNICAL", "CENTRAL_BANKS"]),
        secondary_domains: [pick(["DATA", "FLOW"])],
        playbook_name: pick(["ORB", "Fade", "Data spike", null]),
        tag_names: [pick(["a", "b", "c"]), pick(["d", "e"])],
        time_bucket: pick(["08:30", "09:00", "09:30", "10:00"]),
        weekday: 1 + Math.floor(rand() * 5),
        minutes_from_event: pick([null, 3, -10, 20]),
        regime: pick(["Trending", "Balancing"]),
        prior_day_type: pick(["Normal", "Trend"]),
        symbol: pick(["ES", "NQ", "CL"]),
        level_strength: pick([1, 2, 3, null]),
        confidence: pick([1, 2, 3, 4, 5]),
        readiness: pick([2, 3, 4]),
        r_multiple: Math.round((rand() * 4 - 1.5) * 100) / 100,
      }),
    );
    const t0 = performance.now();
    const res = findPatterns(ts, 8);
    const ms = performance.now() - t0;
    expect(res.tested).toBeGreaterThan(100);
    expect(res.strongest.length).toBe(10);
    expect(ms).toBeLessThan(8000);
  });
});

describe("confluence, missed & observed", () => {
  it("builds the domain pair matrix", () => {
    const pairs = domainPairs([
      trade({ primary_domain: "DATA", secondary_domains: ["TECHNICAL"], r_multiple: 2 }),
      trade({ primary_domain: "DATA", secondary_domains: [], r_multiple: -1 }),
      trade({ primary_domain: "TECHNICAL", secondary_domains: ["DATA", "FLOW"], r_multiple: 1 }),
      trade({ primary_domain: null, r_multiple: 5 }),
    ]);
    expect(pairs).toHaveLength(15);
    const cell = (a: string, b: string) => pairs.find((p) => p.a === a && p.b === b)!;
    expect(cell("TECHNICAL", "DATA")).toMatchObject({ rN: 2, exp: 1.5 });
    expect(cell("DATA", "DATA")).toMatchObject({ rN: 1, exp: -1 });
    expect(cell("DATA", "FLOW")).toMatchObject({ rN: 1, exp: 1 });
    expect(cell("NEWS", "NEWS")).toMatchObject({ rN: 0, exp: null });
  });

  it("profiles observed moves by size and duration", () => {
    const rows = moveProfile(
      [
        trade({ kind: "observed", primary_domain: "NEWS", ticks: -20, duration_sec: 60 }),
        trade({ kind: "observed", primary_domain: "NEWS", ticks: 40, duration_sec: 180 }),
        trade({ kind: "observed", primary_domain: "DATA", ticks: 10, duration_sec: null }),
      ],
      "domain",
    );
    expect(rows[0]).toMatchObject({ key: "NEWS", n: 2, medianTicks: 30, medianDuration: 120 });
    expect(rows[1]).toMatchObject({ key: "DATA", medianTicks: 10, medianDuration: null });
  });
});

describe("process and plan", () => {
  it("fills the process × outcome 2×2", () => {
    const { quads, excluded } = processMatrix([
      trade({ grade_process: "A", r_multiple: 1 }),
      trade({ grade_process: "B", r_multiple: -1 }),
      trade({ grade_process: "C", r_multiple: 2 }),
      trade({ grade_process: "F", r_multiple: -1 }),
      trade({ grade_process: "F", r_multiple: -0.5 }),
      trade({ grade_process: null, r_multiple: 1 }),
      trade({ grade_process: "A", r_multiple: 0, net_pnl: 0 }),
    ]);
    const q = Object.fromEntries(quads.map((x) => [x.key, x]));
    expect(q["good-good"].ids).toHaveLength(1);
    expect(q["good-bad"].ids).toHaveLength(1);
    expect(q["bad-good"].ids).toHaveLength(1);
    expect(q["bad-bad"]).toMatchObject({ netR: -1.5, rN: 2 });
    expect(excluded).toBe(2);
  });

  it("costs mistake tags in R", () => {
    const tags = [
      { id: "m1", name: "Chased", group: "Mistakes", kind: "mistake" },
      { id: "m2", name: "Moved stop", group: "Mistakes", kind: "mistake" },
      { id: "c1", name: "Trend day", group: "Context", kind: "context" },
    ];
    const rows = mistakeCosts(
      [
        trade({ tag_ids: ["m1", "c1"], r_multiple: -1 }),
        trade({ tag_ids: ["m1"], r_multiple: -0.5 }),
        trade({ tag_ids: ["m2"], r_multiple: 0.5 }),
        trade({ tag_ids: ["m2"], r_multiple: null }),
      ],
      tags,
    );
    expect(rows.map((r) => [r.tag, r.n, r.costR, r.avgR])).toEqual([
      ["Chased", 2, -1.5, -0.75],
      ["Moved stop", 2, 0.5, 0.5],
    ]);
  });

  it("counts rule violations per week", () => {
    const rows = ruleViolationsByWeek(
      [
        { date: "2026-09-21", rule: "Max 3 trades", followed: false },
        { date: "2026-09-22", rule: "Max 3 trades", followed: true },
        { date: "2026-09-22", rule: "Flat before data", followed: null },
        { date: "2026-09-29", rule: "Flat before data", followed: false },
      ],
      (d) => (d < "2026-09-28" ? "2026-W39" : "2026-W40"),
    );
    expect(rows).toEqual([
      { week: "2026-W39", checks: 2, violations: 1, rules: { "Max 3 trades": 1 } },
      { week: "2026-W40", checks: 1, violations: 1, rules: { "Flat before data": 1 } },
    ]);
  });

  it("scores scenarios, levels and plan alignment", () => {
    const sc = (outcome: "played" | "partial" | "didnt" | null, traded: boolean | null) => ({
      id: String(seq++),
      date: "2026-09-21",
      session: "EU",
      instrument: "ES",
      direction: "long",
      primary_domain: "DATA",
      outcome,
      traded,
      text: "",
    });
    const s = scenarioOutcomes([
      sc("played", true),
      sc("played", false),
      sc("partial", null),
      sc("didnt", false),
      sc(null, null),
    ]);
    expect(s.graded).toBe(4);
    expect(s.ungraded).toBe(1);
    expect(s.hit.rate).toBe(0.5);
    expect(s.rows[0]).toEqual({ outcome: "played", total: 2, traded: 1, notTraded: 1, unknown: 0 });

    const lv = (
      type: string,
      strength: number,
      tested: boolean | null,
      respected: boolean | null,
    ) => ({
      id: String(seq++),
      date: "2026-09-21",
      instrument: "ES",
      level_type: type,
      strength,
      tested,
      respected,
    });
    const levels = [
      lv("VAH", 3, true, true),
      lv("VAH", 3, true, false),
      lv("POC", 2, true, true),
      lv("POC", 2, false, null),
      lv("POC", 2, null, null),
    ];
    expect(levelRespect(levels, "type").map((r) => [r.key, r.hits, r.n])).toEqual([
      ["VAH", 1, 2],
      ["POC", 1, 1],
    ]);
    expect(levelRespect(levels, "strength").map((r) => r.label)).toEqual(["Strong", "Medium"]);

    const rows = planAlignment([
      trade({ scenario_id: "s", r_multiple: 2 }),
      trade({ key_level_id: "k", r_multiple: 1 }),
      trade({ r_multiple: -1 }),
    ]);
    expect(rows.map((r) => [r.key, r.m.n, r.m.expectancy])).toEqual([
      ["linked", 2, 1.5],
      ["unlinked", 1, -1],
    ]);
  });
});
