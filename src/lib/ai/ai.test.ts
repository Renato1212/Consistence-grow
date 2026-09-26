import { describe, expect, it } from "vitest";

import { HolidayCalendar } from "@/lib/calendar/holidays";
import { DEFAULT_FILTER, parseFilter } from "@/lib/insights/filters";
import { cyrb53, dataHash } from "./hash";
import { buildPayload, selectTrades, specHash, type AiContext, type AiTrade } from "./payload";
import {
  filterKey,
  filterLabel,
  filterRequest,
  reviewWeek,
  sessionRequest,
  slotRequest,
  weeklyRequest,
} from "./requests";
import { outputSchema, validationErrors } from "./schema";

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function trade(p: Partial<AiTrade> = {}): AiTrade {
  seq++;
  const r = p.r_multiple === undefined ? 1 : p.r_multiple;
  return {
    id: uuid(seq),
    kind: "taken",
    trade_date: "2026-09-21",
    entry_at: `2026-09-21T09:${String(seq % 60).padStart(2, "0")}:00Z`,
    updated_at: "2026-09-21T10:00:00Z",
    symbol: "ES",
    currency: "USD",
    direction: "long",
    net_pnl: r === null ? 10 : r * 100,
    r_multiple: r,
    ticks: 8,
    duration_sec: 300,
    session: "EU",
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
    thesis: null,
    lesson: null,
    ...p,
  };
}

function ctx(trades: AiTrade[], over: Partial<AiContext> = {}): AiContext {
  return {
    trades,
    tags: [],
    playbooks: [
      { id: uuid(9001), name: "ORB", version: 2, primary_domain: "TECHNICAL", status: "active" },
    ],
    scenarios: [],
    levels: [],
    rule_checks: [],
    debriefs: [],
    weekly_reviews: [],
    holidays: [],
    requests: [],
    recent_hashes: [],
    pattern_min_n: 8,
    ...over,
  };
}

describe("hash", () => {
  it("is deterministic and order-independent over trades", () => {
    expect(cyrb53("abc")).toBe(cyrb53("abc"));
    expect(cyrb53("abc")).not.toBe(cyrb53("abd"));
    const a = { id: "a", updated_at: "1" };
    const b = { id: "b", updated_at: "2" };
    const h1 = dataHash({ kind: "filter", filterKey: "", trades: [a, b] });
    expect(dataHash({ kind: "filter", filterKey: "", trades: [b, a] })).toBe(h1);
    expect(
      dataHash({ kind: "filter", filterKey: "", trades: [a, { ...b, updated_at: "3" }] }),
    ).not.toBe(h1);
    expect(dataHash({ kind: "session", filterKey: "", trades: [a, b] })).not.toBe(h1);
  });
});

describe("output schema", () => {
  const finding = {
    title: "Data fades pay",
    type: "strength",
    observation: "n=24, expectancy +0.40R (+0.10 … +0.70).",
    evidence_trade_ids: [uuid(1)],
    sample_size: 24,
    confidence: "medium",
    suggested_experiment: "Take only the first 15 min after the print for 10 trades.",
    related_playbook_id: null,
    domain: "DATA",
  };

  it("accepts a valid output and defaults optional nulls", () => {
    const minimal: Record<string, unknown> = { ...finding };
    delete minimal.related_playbook_id;
    delete minimal.domain;
    const r = outputSchema.safeParse({ summary: "Short summary here.", findings: [minimal] });
    expect(r.success).toBe(true);
    expect(r.data!.findings[0].related_playbook_id).toBeNull();
  });

  it("forces low confidence on small samples and reports readable errors", () => {
    const r = outputSchema.safeParse({
      summary: "Short summary here.",
      findings: [{ ...finding, sample_size: 12, confidence: "high", evidence_trade_ids: ["x"] }],
    });
    expect(r.success).toBe(false);
    const errors = validationErrors(r.error!);
    expect(errors.some((e) => e.includes("confidence") && e.includes("below 20"))).toBe(true);
    expect(errors.some((e) => e.startsWith("findings.0.evidence_trade_ids.0"))).toBe(true);
    expect(outputSchema.safeParse({ summary: "Short summary here.", findings: [] }).success).toBe(
      false,
    );
  });
});

describe("requests and slots", () => {
  const cal = new HolidayCalendar([
    { date: "2026-11-26", market: "US", name: "Thanksgiving", earlyClose: null },
    { date: "2026-11-27", market: "US", name: "Day after Thanksgiving", earlyClose: "13:00" },
    { date: "2026-12-25", market: "US", name: "Christmas", earlyClose: null },
    { date: "2026-12-25", market: "UK", name: "Christmas", earlyClose: null },
  ]);

  it("session requests are the session's last 90 days", () => {
    const eu = sessionRequest("EU");
    expect(eu.filter.range).toBe("90d");
    expect(eu.filter.values).toEqual({ session: ["EU"] });
    expect(eu.filterKey).toBe("range=90d&ses=EU");
    expect(parseFilter(new URLSearchParams(eu.filterKey))).toEqual(eu.filter);
  });

  it("slots skip weekends and closed markets", () => {
    expect(slotRequest("eu", "2026-09-26", cal)).toEqual({ skip: "weekend" });
    expect(slotRequest("us", "2026-11-26", cal)).toEqual({ skip: "US holiday: Thanksgiving" });
    expect("skip" in slotRequest("eu", "2026-11-26", cal)).toBe(false);
    expect("skip" in slotRequest("us", "2026-11-27", cal)).toBe(false); // early close still trades
    expect(slotRequest("eu", "2026-12-25", cal)).toEqual({ skip: "US and UK closed" });
    const us = slotRequest("us", "2026-09-28", cal);
    expect("skip" in us ? null : us.slot).toBe("us");
  });

  it("weekly covers the week just traded", () => {
    expect(reviewWeek("2026-09-26")).toBe("2026-W39"); // Saturday → this week
    expect(reviewWeek("2026-09-28")).toBe("2026-W39"); // Monday → last week
    const w = weeklyRequest("2026-W39")!;
    expect(w.filter).toMatchObject({ range: "custom", from: "2026-09-21", to: "2026-09-27" });
    expect(weeklyRequest("nope")).toBeNull();
    const s = slotRequest("weekly", "2026-09-26", cal);
    expect("skip" in s ? null : s.week).toBe("2026-W39");
  });

  it("filter requests carry a readable label and a canonical key", () => {
    const f = { ...DEFAULT_FILTER, range: "30d" as const, values: { domain: ["DATA"] } };
    const r = filterRequest(f);
    expect(r.label).toBe("Last 30 days · Primary domain: Data");
    expect(r.filterKey).toBe(filterKey(f));
    expect(filterLabel({ ...DEFAULT_FILTER, kinds: ["taken", "missed"] })).toBe(
      "All time · Kinds: taken, missed",
    );
  });
});

describe("payload", () => {
  it("is empty without trades and carries instructions, schema and only its own ids", () => {
    const today = "2026-09-26";
    expect(buildPayload(ctx([]), sessionRequest("EU"), today, null)).toEqual({
      empty: true,
      reason: "No trades in this filter",
    });

    const trades = [
      ...Array.from({ length: 10 }, (_, i) =>
        trade({ session: "EU", r_multiple: i % 2 ? 2 : -1, lesson: i === 3 ? "Waited" : null }),
      ),
      trade({ session: "US", r_multiple: 5 }),
      trade({ session: "EU", kind: "missed", r_multiple: 3 }),
    ];
    const built = buildPayload(ctx(trades), sessionRequest("EU"), today, "req-1");
    if (built.empty) throw new Error("expected a payload");
    const p = built.payload as {
      baseline: { n: number; expectancy_r: number };
      instructions: string;
      output_schema: unknown;
      trades: { id: string; session: string }[];
      missed_by_playbook: { n: number }[];
      request: { id: string };
    };
    expect(p.request.id).toBe("req-1");
    expect(p.baseline.n).toBe(10);
    expect(p.baseline.expectancy_r).toBe(0.5);
    expect(p.instructions).toContain("Use only numbers that appear in the payload");
    expect(p.output_schema).toBeTruthy();
    expect(p.trades.every((t) => t.session === "EU")).toBe(true);
    expect(built.tradeIds).toEqual(p.trades.map((t) => t.id));
    expect(built.playbookIds).toEqual([uuid(9001)]);
    expect(p.missed_by_playbook[0].n).toBe(1);
    expect(built.dataHash).toBe(specHash(ctx(trades), sessionRequest("EU"), today));
  });

  it("caps trades at 100 and keeps must-include ids", () => {
    const many = Array.from({ length: 150 }, (_, i) => trade({ r_multiple: (i % 7) - 3 }));
    const picked = selectTrades(many, [many[5].id]);
    expect(picked).toHaveLength(100);
    expect(picked.map((t) => t.id)).toContain(many[5].id);
    // chronological for reading
    const times = picked.map((t) => t.entry_at);
    expect([...times].sort()).toEqual(times);
  });

  it("weekly payloads include the week's reflection, goals and debriefs; the hash follows them", () => {
    const today = "2026-09-26";
    const spec = weeklyRequest("2026-W39")!;
    const t = [trade({ trade_date: "2026-09-22" })];
    const base = ctx(t, {
      weekly_reviews: [
        { week: "2026-W38", reflection: null, goals: ["Wait for the retest"] },
        { week: "2026-W39", reflection: "Patient week", goals: [] },
      ],
      debriefs: [
        {
          date: "2026-09-22",
          grade_context: "A",
          grade_edge: "B",
          grade_process: "A",
          went_well: ["Waited"],
          to_improve: [],
          lesson: "Patience",
          complete: true,
        },
      ],
    });
    const built = buildPayload(base, spec, today, null);
    if (built.empty) throw new Error("expected a payload");
    const weekly = (built.payload as { weekly: Record<string, unknown> }).weekly;
    expect(weekly).toMatchObject({
      week: "2026-W39",
      reflection: "Patient week",
      goals_for_this_week: ["Wait for the retest"],
    });
    expect((weekly.debriefs as unknown[]).length).toBe(1);
    const edited = {
      ...base,
      weekly_reviews: [{ week: "2026-W39", reflection: "Edited", goals: [] }],
    };
    expect(specHash(edited, spec, today)).not.toBe(built.dataHash);
  });

  it("the browser's hash for a filter matches the server's", () => {
    const today = "2026-09-26";
    const trades = [trade(), trade({ kind: "observed", r_multiple: null })];
    const spec = filterRequest({ ...DEFAULT_FILTER });
    const server = buildPayload(ctx(trades), spec, today, null);
    const browser = specHash(
      { trades, debriefs: [], weekly_reviews: [], rule_checks: [] },
      spec,
      today,
    );
    expect(server.empty ? null : server.dataHash).toBe(browser);
  });
});
