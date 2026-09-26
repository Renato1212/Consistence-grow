/**
 * Builds the compact JSON an analysis runs on, from the same pure Insights
 * functions the pages use (so Claude sees exactly the numbers the trader sees).
 * Only ids that appear in the payload may be cited as evidence.
 */
import {
  domainPairs,
  breakdownBy,
  findPatterns,
  levelRespect,
  mistakeCosts,
  moveProfile,
  planAlignment,
  processMatrix,
  ruleViolationsByWeek,
  scenarioOutcomes,
  type RateRow,
  type Row,
} from "@/lib/insights/analysis";
import {
  isoWeekKey,
  isoWeekOf,
  parseIsoWeekKey,
  isoWeekStart,
  addDays,
} from "@/lib/calendar/dates";
import { displayValue, type DimensionKey } from "@/lib/insights/dimensions";
import { applyFilter, dateBounds, matchesExceptKind } from "@/lib/insights/filters";
import { computeMetrics, round, type Interval, type Metrics } from "@/lib/insights/metrics";
import type {
  InsightTrade,
  LevelFact,
  RuleCheckFact,
  ScenarioFact,
  TagInfo,
} from "@/lib/insights/types";
import { dataHash, PAYLOAD_VERSION } from "./hash";
import { INSTRUCTIONS } from "./instructions";
import type { RequestSpec } from "./requests";
import { OUTPUT_JSON_SCHEMA } from "./schema";

export type AiTrade = InsightTrade & {
  updated_at: string;
  thesis?: string | null;
  lesson?: string | null;
};

export type AiPlaybook = {
  id: string;
  name: string;
  version: number;
  primary_domain: string;
  status: string;
};
export type AiDebrief = {
  date: string;
  grade_context: string | null;
  grade_edge: string | null;
  grade_process: string | null;
  went_well: string[];
  to_improve: string[];
  lesson: string | null;
  complete: boolean;
};
export type AiWeekly = { week: string; reflection: string | null; goals: string[] };
export type AiOpenRequest = {
  id: string;
  kind: RequestSpec["kind"];
  slot: RequestSpec["slot"];
  label: string;
  filter: unknown;
  filter_key: string;
  week: string | null;
  status: "pending" | "served";
  created_at: string;
};

/** What `ai_context` returns. */
export type AiContext = {
  trades: AiTrade[];
  tags: TagInfo[];
  playbooks: AiPlaybook[];
  scenarios: ScenarioFact[];
  levels: LevelFact[];
  rule_checks: RuleCheckFact[];
  debriefs: AiDebrief[];
  weekly_reviews: AiWeekly[];
  holidays: { date: string; market: "US" | "UK"; name: string; early_close: string | null }[];
  requests: AiOpenRequest[];
  recent_hashes: string[];
  pattern_min_n: number;
};

const MAX_TRADES = 100;
const MAX_ROWS = 15;

const ci = (i: Interval | null, dp = 2) => (i ? [round(i.lo, dp), round(i.hi, dp)] : null);

function metricsJson(m: Metrics) {
  return {
    n: m.n,
    r_n: m.rN,
    wins: m.wins,
    losses: m.losses,
    win_rate: m.winRate === null ? null : round(m.winRate, 3),
    win_rate_ci95: ci(m.winCI, 3),
    expectancy_r: m.expectancy,
    expectancy_ci95: ci(m.expCI),
    net_r: m.netR,
    avg_win_r: m.avgWinR,
    avg_loss_r: m.avgLossR,
    profit_factor: m.profitFactor,
    max_drawdown_r: m.maxDrawdownR,
    net_by_currency: Object.fromEntries(
      Object.entries(m.byCurrency).map(([c, v]) => [c, round(v, 2)]),
    ),
    longest_win_streak: m.longestWin,
    longest_loss_streak: m.longestLoss,
  };
}

function rowJson(r: Row) {
  return {
    value: r.label,
    n: r.m.n,
    r_n: r.m.rN,
    win_rate: r.m.winRate === null ? null : round(r.m.winRate, 3),
    win_rate_ci95: ci(r.m.winCI, 3),
    expectancy_r: r.m.expectancy,
    expectancy_ci95: ci(r.m.expCI),
    net_r: r.m.rN ? r.m.netR : null,
  };
}

const BREAKDOWNS: DimensionKey[] = [
  "domain",
  "secondary",
  "domainCount",
  "playbook",
  "instrument",
  "direction",
  "session",
  "timeBucket",
  "weekday",
  "event",
  "eventType",
  "regime",
  "priorDay",
  "tag",
  "gradeContext",
  "gradeEdge",
  "gradeProcess",
  "confidence",
  "readiness",
  "prep",
  "levelStrength",
  "exitReason",
];

function rateJson(r: RateRow) {
  return {
    value: r.label,
    tested: r.n,
    respected: r.hits,
    rate: r.rate === null ? null : round(r.rate, 3),
    rate_ci95: ci(r.ci, 3),
  };
}

function tradeJson(t: AiTrade) {
  return {
    id: t.id,
    kind: t.kind,
    date: t.trade_date,
    time_bucket_exchange: t.time_bucket,
    weekday: t.weekday,
    session: t.session,
    symbol: t.symbol,
    direction: t.direction,
    r: t.r_multiple === null ? null : round(t.r_multiple),
    net_pnl: t.net_pnl === null ? null : round(t.net_pnl),
    currency: t.currency,
    ticks: t.ticks,
    playbook: t.playbook_name,
    playbook_id: t.playbook_id,
    domain: t.primary_domain,
    secondary_domains: t.secondary_domains,
    tags: t.tag_names,
    grades: { context: t.grade_context, edge: t.grade_edge, process: t.grade_process },
    confidence: t.confidence,
    event: t.event_title,
    minutes_from_event: t.minutes_from_event,
    regime: t.regime,
    prior_day_type: t.prior_day_type,
    readiness: t.readiness,
    prep_done: t.prep_done,
    exit_reason: t.exit_reason,
    thesis: t.thesis ?? null,
    lesson: t.lesson ?? null,
  };
}

/** Pick ≤ 100 trades: pattern examples, R extremes, anything with a lesson, then the most recent. */
export function selectTrades(trades: AiTrade[], mustInclude: string[]): AiTrade[] {
  const byId = new Map(trades.map((t) => [t.id, t]));
  const withR = trades.filter((t) => t.r_multiple !== null);
  const sortedR = [...withR].sort((a, b) => Number(b.r_multiple) - Number(a.r_multiple));
  const recent = [...trades].sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  const order = [
    ...mustInclude.map((id) => byId.get(id)).filter((t): t is AiTrade => !!t),
    ...sortedR.slice(0, 12),
    ...sortedR.slice(-12).reverse(),
    ...recent.filter((t) => t.lesson).slice(0, 20),
    ...recent,
  ];
  const seen = new Set<string>();
  const out: AiTrade[] = [];
  for (const t of order) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= MAX_TRADES) break;
  }
  return out.sort((a, b) => a.entry_at.localeCompare(b.entry_at));
}

/** Trades an analysis depends on (all kinds within the filter's other constraints). */
export function scopeTrades(trades: AiTrade[], spec: RequestSpec, today: string): AiTrade[] {
  return trades.filter((t) => matchesExceptKind(t, spec.filter, today));
}

function weeklyExtras(
  ctx: Pick<AiContext, "debriefs" | "weekly_reviews" | "rule_checks">,
  week: string,
) {
  const w = parseIsoWeekKey(week);
  if (!w) return null;
  const from = isoWeekStart(w.year, w.week);
  const to = addDays(from, 6);
  const prev = isoWeekOf(addDays(from, -7));
  const inWeek = (d: string) => d >= from && d <= to;
  const review = ctx.weekly_reviews.find((r) => r.week === week);
  return {
    week,
    reflection: review?.reflection ?? null,
    goals_set_for_next_week: review?.goals ?? [],
    goals_for_this_week:
      ctx.weekly_reviews.find((r) => r.week === isoWeekKey(prev.year, prev.week))?.goals ?? [],
    debriefs: ctx.debriefs.filter((d) => inWeek(d.date)),
    rule_checks: ctx.rule_checks.filter((c) => inWeek(c.date) && c.followed !== null),
  };
}

/** The hash an analysis of `spec` over this data would get (same in browser and server). */
export function specHash(
  ctx: Pick<AiContext, "trades" | "debriefs" | "weekly_reviews" | "rule_checks">,
  spec: RequestSpec,
  today: string,
): string {
  const extra =
    spec.kind === "weekly" && spec.week ? JSON.stringify(weeklyExtras(ctx, spec.week)) : "";
  return dataHash({
    kind: spec.kind,
    filterKey: spec.filterKey,
    week: spec.week,
    trades: scopeTrades(ctx.trades, spec, today),
    extra,
  });
}

export type BuiltPayload =
  | { empty: true; reason: string }
  | {
      empty: false;
      dataHash: string;
      tradeIds: string[];
      playbookIds: string[];
      payload: Record<string, unknown>;
    };

export function buildPayload(
  ctx: AiContext,
  spec: RequestSpec,
  today: string,
  requestId: string | null,
): BuiltPayload {
  const scoped = scopeTrades(ctx.trades, spec, today);
  const trades = applyFilter(ctx.trades, spec.filter, today) as AiTrade[];
  if (trades.length === 0) return { empty: true, reason: "No trades in this filter" };

  const bounds = dateBounds(spec.filter, today);
  const inRange = (d: string) =>
    (!bounds.from || d >= bounds.from) && (!bounds.to || d <= bounds.to);
  const missed = scoped.filter((t) => t.kind === "missed");
  const observed = scoped.filter((t) => t.kind === "observed");

  const patterns = findPatterns(trades, ctx.pattern_min_n, { top: 8 });
  const patternJson = (list: typeof patterns.strongest) =>
    list.map((p) => ({
      conditions: p.label,
      n: p.n,
      expectancy_r: p.expectancy,
      expectancy_ci95: ci(p.expCI),
      lift_vs_baseline_r: p.lift,
      win_rate: p.winRate === null ? null : round(p.winRate, 3),
      win_rate_ci95: ci(p.winCI, 3),
      example_trade_ids: p.ids.slice(-5),
    }));
  const strongest = patternJson(patterns.strongest);
  const leaks = patternJson(patterns.leaks);
  const mustInclude = [...strongest, ...leaks].flatMap((p) => p.example_trade_ids);
  const selected = selectTrades(trades as AiTrade[], mustInclude);
  const selectedIds = new Set(selected.map((t) => t.id));
  for (const p of [...strongest, ...leaks])
    p.example_trade_ids = p.example_trade_ids.filter((id) => selectedIds.has(id));

  const breakdowns: Record<string, ReturnType<typeof rowJson>[]> = {};
  for (const key of BREAKDOWNS) {
    const rows = breakdownBy(trades, key)
      .filter((r) => r.key !== "—" || key === "event")
      .slice(0, MAX_ROWS)
      .map(rowJson);
    if (rows.length > 1 || (rows.length === 1 && rows[0].n < trades.length)) breakdowns[key] = rows;
  }

  const { quads, excluded } = processMatrix(trades);
  const scenarios = ctx.scenarios.filter((s) => inRange(s.date));
  const levels = ctx.levels.filter((l) => inRange(l.date));
  const weekOf = (d: string) => {
    const w = isoWeekOf(d);
    return isoWeekKey(w.year, w.week);
  };
  const pairs = domainPairs(trades)
    .filter((p) => p.rN > 0)
    .map((p) => ({
      domains:
        p.a === p.b
          ? `${displayValue("domain", p.a)} only`
          : `${displayValue("domain", p.a)} + ${displayValue("domain", p.b)}`,
      r_n: p.rN,
      expectancy_r: p.exp,
    }));

  const payload = {
    version: PAYLOAD_VERSION,
    request: {
      id: requestId,
      kind: spec.kind,
      slot: spec.slot,
      label: spec.label,
      week: spec.week,
      date_range: bounds,
      today_lisbon: today,
    },
    instructions: INSTRUCTIONS,
    output_schema: OUTPUT_JSON_SCHEMA,
    baseline: metricsJson(computeMetrics(trades)),
    breakdowns,
    patterns: {
      min_n: ctx.pattern_min_n,
      tested: patterns.tested,
      baseline_expectancy_r: patterns.baseline.expectancy,
      strongest,
      leaks,
    },
    domain_pairs: pairs,
    process: {
      process_vs_outcome: Object.fromEntries(
        quads.map((q) => [q.key, { n: q.ids.length, net_r: q.rN ? q.netR : null }]),
      ),
      ungraded_or_scratch: excluded,
      mistakes: mistakeCosts(trades, ctx.tags).map((m) => ({
        tag: m.tag,
        n: m.n,
        total_r: m.rN ? m.costR : null,
        avg_r: m.avgR,
      })),
      rule_violations_by_week: ruleViolationsByWeek(
        ctx.rule_checks.filter((c) => inRange(c.date)),
        weekOf,
      ),
    },
    plan: (() => {
      const sc = scenarioOutcomes(scenarios);
      return {
        scenarios: {
          graded: sc.graded,
          not_graded: sc.ungraded,
          played_out_rate: sc.hit.rate === null ? null : round(sc.hit.rate, 3),
          played_out_rate_ci95: ci(sc.hit.ci, 3),
          by_outcome: sc.rows,
        },
        key_levels_respected_by_type: levelRespect(levels, "type").map(rateJson),
        key_levels_respected_by_strength: levelRespect(levels, "strength").map(rateJson),
        trades_vs_plan: planAlignment(trades).map(rowJson),
      };
    })(),
    missed_by_playbook: breakdownBy(missed, "playbook").map(rowJson),
    observed_moves_by_domain: moveProfile(observed, "domain").map((r) => ({
      trigger_domain: r.label,
      n: r.n,
      median_abs_ticks: r.medianTicks,
      median_duration_sec: r.medianDuration,
    })),
    weekly: spec.kind === "weekly" && spec.week ? weeklyExtras(ctx, spec.week) : undefined,
    playbooks: ctx.playbooks.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.primary_domain,
      status: p.status,
      version: p.version,
    })),
    trades_note: `${selected.length} of ${trades.length} trades in the filter (pattern examples, R extremes, trades with lessons, then the most recent).`,
    trades: selected.map(tradeJson),
  };

  return {
    empty: false,
    dataHash: specHash(ctx, spec, today),
    tradeIds: selected.map((t) => t.id),
    playbookIds: ctx.playbooks.map((p) => p.id),
    payload,
  };
}
