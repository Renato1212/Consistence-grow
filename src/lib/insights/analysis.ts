/**
 * Breakdowns, the time × weekday heatmap, the Pattern Finder, domain
 * confluence, process and plan accuracy. Pure functions over the filtered set;
 * every row carries its trade ids for click-through.
 */
import { DOMAIN_CODES } from "@/lib/domains";
import {
  DIMENSION_BY_KEY,
  displayValue,
  GRADES,
  PATTERN_DIMENSIONS,
  type DimensionKey,
} from "./dimensions";
import {
  bootstrapMean,
  computeMetrics,
  mean,
  median,
  outcome,
  round,
  rValues,
  wilson,
  type Interval,
  type Metrics,
} from "./metrics";
import type { InsightTrade, LevelFact, RuleCheckFact, ScenarioFact, TagInfo } from "./types";

export type Row = { key: string; label: string; ids: string[]; m: Metrics };

function group(
  trades: InsightTrade[],
  valuesOf: (t: InsightTrade) => string[],
  emptyKey: string | null = "—",
): Map<string, InsightTrade[]> {
  const out = new Map<string, InsightTrade[]>();
  for (const t of trades) {
    const vs = valuesOf(t);
    const keys = vs.length ? vs : emptyKey === null ? [] : [emptyKey];
    for (const k of keys) {
      const list = out.get(k);
      if (list) list.push(t);
      else out.set(k, [t]);
    }
  }
  return out;
}

function rows(
  groups: Map<string, InsightTrade[]>,
  label: (k: string) => string,
  order?: string[],
): Row[] {
  const list = [...groups.entries()].map(([key, ts]) => ({
    key,
    label: label(key),
    ids: ts.map((t) => t.id),
    m: computeMetrics(ts),
  }));
  if (order) {
    const pos = (k: string) => (order.includes(k) ? order.indexOf(k) : k === "—" ? 1e6 : 1e5);
    return list.sort((a, b) => pos(a.key) - pos(b.key) || a.key.localeCompare(b.key));
  }
  return list.sort(
    (a, b) =>
      Number(a.key === "—") - Number(b.key === "—") || b.m.n - a.m.n || a.key.localeCompare(b.key),
  );
}

/** One row per value of a dimension (multi-valued dimensions count a trade in each). */
export function breakdownBy(trades: InsightTrade[], key: DimensionKey): Row[] {
  const dim = DIMENSION_BY_KEY[key];
  const order =
    dim.order ?? (key === "timeBucket" || key === "month" ? sortedKeys(trades, key) : undefined);
  return rows(group(trades, dim.values), (k) => displayValue(key, k), order);
}

function sortedKeys(trades: InsightTrade[], key: DimensionKey): string[] {
  return [...new Set(trades.flatMap(DIMENSION_BY_KEY[key].values))].sort();
}

export type HeatCell = {
  weekday: number;
  bucket: string;
  ids: string[];
  n: number;
  rN: number;
  exp: number | null;
};

/** Time of day (exchange buckets) × weekday: expectancy and n per cell. */
export function timeWeekdayHeatmap(trades: InsightTrade[]): {
  buckets: string[];
  weekdays: number[];
  cells: Map<string, HeatCell>;
} {
  const cells = new Map<string, HeatCell>();
  for (const t of trades) {
    if (!t.time_bucket || !t.weekday) continue;
    const id = `${t.weekday}|${t.time_bucket}`;
    const c = cells.get(id) ?? {
      weekday: t.weekday,
      bucket: t.time_bucket,
      ids: [],
      n: 0,
      rN: 0,
      exp: null,
    };
    c.ids.push(t.id);
    c.n++;
    cells.set(id, c);
  }
  const byId = new Map(trades.map((t) => [t.id, t]));
  for (const c of cells.values()) {
    const rs = rValues(c.ids.map((i) => byId.get(i)!));
    c.rN = rs.length;
    const e = mean(rs);
    c.exp = e === null ? null : round(e);
  }
  const buckets = [...new Set([...cells.values()].map((c) => c.bucket))].sort();
  const present = new Set([...cells.values()].map((c) => c.weekday));
  const weekdays = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || present.has(d));
  return { buckets, weekdays, cells };
}

// ---------------------------------------------------------------------------
// Pattern Finder
// ---------------------------------------------------------------------------

export type Condition = { dim: DimensionKey; value: string };

export type Pattern = {
  conditions: Condition[];
  label: string;
  ids: string[];
  n: number;
  rN: number;
  expectancy: number;
  lift: number;
  winRate: number | null;
  winCI: Interval | null;
  expCI: Interval | null;
};

export type PatternResult = {
  baseline: { n: number; rN: number; expectancy: number | null };
  tested: number;
  strongest: Pattern[];
  leaks: Pattern[];
};

function combos<T>(items: T[], k: number, start = 0, acc: T[] = [], out: T[][] = []): T[][] {
  if (acc.length === k) {
    out.push([...acc]);
    return out;
  }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    combos(items, k, i + 1, acc, out);
    acc.pop();
  }
  return out;
}

/**
 * Mine 2- and 3-attribute combinations within the filtered trades. Only
 * trades with an R count (expectancy needs one); a combination needs
 * rN ≥ minN. A 3-combination that selects exactly the same trades as one of
 * its 2-subsets adds nothing and is dropped, and so is any attribute shared by
 * every trade. Ranked by expectancy lift over
 * the baseline; intervals are computed for the rows returned.
 */
export function findPatterns(
  trades: InsightTrade[],
  minN: number,
  opts: { top?: number; dims?: DimensionKey[] } = {},
): PatternResult {
  const top = opts.top ?? 10;
  const dims = opts.dims ?? PATTERN_DIMENSIONS;
  const withR = trades.filter((t) => t.r_multiple !== null);
  const rs = withR.map((t) => Number(t.r_multiple));
  const base = mean(rs);
  const baseline = {
    n: trades.length,
    rN: withR.length,
    expectancy: base === null ? null : round(base),
  };
  if (base === null) return { baseline, tested: 0, strongest: [], leaks: [] };

  // Items are "dim\u0000value"; per trade the list of items it has. An item
  // every trade shares (e.g. the one playbook filtered to) adds nothing to a
  // combination, so it is left out.
  const itemsOf = withR.map((t) => {
    const items: string[] = [];
    for (const d of dims) {
      for (const v of DIMENSION_BY_KEY[d].values(t)) {
        if (d === "event" && v === "No event") continue;
        items.push(`${d}\u0000${v}`);
      }
    }
    return items;
  });
  const itemCount = new Map<string, number>();
  for (const items of itemsOf) for (const i of items) itemCount.set(i, (itemCount.get(i) ?? 0) + 1);
  const buckets = new Map<string, number[]>();
  for (let ti = 0; ti < withR.length; ti++) {
    const items = itemsOf[ti].filter((i) => itemCount.get(i)! < withR.length);
    for (const k of [2, 3]) {
      for (const c of combos(items, k)) {
        const ds = c.map((x) => x.slice(0, x.indexOf("\u0000")));
        if (new Set(ds).size !== ds.length) continue; // one value per dimension
        const key = c.join("\u0001");
        const list = buckets.get(key);
        if (list) list.push(ti);
        else buckets.set(key, [ti]);
      }
    }
  }

  const sizeOf = (key: string) => buckets.get(key)?.length ?? 0;
  const candidates: { key: string; idx: number[]; exp: number }[] = [];
  let tested = 0;
  for (const [key, idx] of buckets) {
    if (idx.length < minN) continue;
    const parts = key.split("\u0001");
    if (parts.length === 3) {
      const redundant = combos(parts, 2).some((sub) => sizeOf(sub.join("\u0001")) === idx.length);
      if (redundant) continue;
    }
    tested++;
    const e = idx.reduce((a, i) => a + rs[i], 0) / idx.length;
    candidates.push({ key, idx, exp: e });
  }

  const build = (c: { key: string; idx: number[]; exp: number }): Pattern => {
    const conditions = c.key.split("\u0001").map((p) => {
      const [dim, value] = p.split("\u0000");
      return { dim: dim as DimensionKey, value };
    });
    const ts = c.idx.map((i) => withR[i]);
    const outcomes = ts.map(outcome).filter((o): o is number => o !== null);
    const wins = outcomes.filter((o) => o > 0).length;
    const decided = wins + outcomes.filter((o) => o < 0).length;
    return {
      conditions,
      label: conditions
        .map((x) => `${DIMENSION_BY_KEY[x.dim].label}: ${displayValue(x.dim, x.value)}`)
        .join(" + "),
      ids: ts.map((t) => t.id),
      n: ts.length,
      rN: ts.length,
      expectancy: round(c.exp),
      lift: round(c.exp - base),
      winRate: decided ? wins / decided : null,
      winCI: wilson(wins, decided),
      expCI: bootstrapMean(c.idx.map((i) => rs[i])),
    };
  };

  const byLift = [...candidates].sort((a, b) => b.exp - a.exp || b.idx.length - a.idx.length);
  const strongest = byLift
    .filter((c) => c.exp > base)
    .slice(0, top)
    .map(build);
  const leaks = byLift
    .filter((c) => c.exp < base)
    .reverse()
    .slice(0, top)
    .map(build);
  return { baseline, tested, strongest, leaks };
}

// ---------------------------------------------------------------------------
// Domain confluence
// ---------------------------------------------------------------------------

export type PairCell = { a: string; b: string; ids: string[]; rN: number; exp: number | null };

export function domainsOf(t: InsightTrade): string[] {
  if (!t.primary_domain) return [];
  return [...new Set([t.primary_domain, ...(t.secondary_domains ?? [])])];
}

/** Domain pair matrix: diagonal = single-domain trades, off-diagonal = both present. */
export function domainPairs(trades: InsightTrade[]): PairCell[] {
  const out: PairCell[] = [];
  for (let i = 0; i < DOMAIN_CODES.length; i++) {
    for (let j = i; j < DOMAIN_CODES.length; j++) {
      const a = DOMAIN_CODES[i];
      const b = DOMAIN_CODES[j];
      const ts = trades.filter((t) => {
        const ds = domainsOf(t);
        return a === b ? ds.length === 1 && ds[0] === a : ds.includes(a) && ds.includes(b);
      });
      const rs = rValues(ts);
      const e = mean(rs);
      out.push({
        a,
        b,
        ids: ts.map((t) => t.id),
        rN: rs.length,
        exp: e === null ? null : round(e),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Missed & observed
// ---------------------------------------------------------------------------

export type MoveRow = {
  key: string;
  label: string;
  ids: string[];
  n: number;
  medianTicks: number | null;
  medianDuration: number | null;
};

/** Observed fast moves grouped by a dimension: size (|ticks|) and duration. */
export function moveProfile(observed: InsightTrade[], key: DimensionKey): MoveRow[] {
  const dim = DIMENSION_BY_KEY[key];
  const g = group(observed, dim.values);
  const order = dim.order ?? (key === "timeBucket" ? sortedKeys(observed, key) : undefined);
  const list = [...g.entries()].map(([k, ts]) => ({
    key: k,
    label: displayValue(key, k),
    ids: ts.map((t) => t.id),
    n: ts.length,
    medianTicks: median(ts.filter((t) => t.ticks !== null).map((t) => Math.abs(Number(t.ticks)))),
    medianDuration: median(
      ts.filter((t) => t.duration_sec !== null).map((t) => Number(t.duration_sec)),
    ),
  }));
  if (order) {
    const pos = (k: string) => (order.includes(k) ? order.indexOf(k) : 1e6);
    return list.sort((a, b) => pos(a.key) - pos(b.key));
  }
  return list.sort((a, b) => Number(a.key === "—") - Number(b.key === "—") || b.n - a.n);
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

export type QuadKey = "good-good" | "good-bad" | "bad-good" | "bad-bad";
export type Quad = { key: QuadKey; ids: string[]; netR: number; rN: number };

/** Process (A/B good, C/F bad) × outcome (win good, loss bad); ungraded or scratch excluded. */
export function processMatrix(trades: InsightTrade[]): { quads: Quad[]; excluded: number } {
  const quads: Record<QuadKey, Quad> = {
    "good-good": { key: "good-good", ids: [], netR: 0, rN: 0 },
    "good-bad": { key: "good-bad", ids: [], netR: 0, rN: 0 },
    "bad-good": { key: "bad-good", ids: [], netR: 0, rN: 0 },
    "bad-bad": { key: "bad-bad", ids: [], netR: 0, rN: 0 },
  };
  let excluded = 0;
  for (const t of trades) {
    const o = outcome(t);
    if (!t.grade_process || !GRADES.includes(t.grade_process) || o === null || o === 0) {
      excluded++;
      continue;
    }
    const p = t.grade_process === "A" || t.grade_process === "B" ? "good" : "bad";
    const q = quads[`${p}-${o > 0 ? "good" : "bad"}` as QuadKey];
    q.ids.push(t.id);
    if (t.r_multiple !== null) {
      q.netR = round(q.netR + Number(t.r_multiple));
      q.rN++;
    }
  }
  return { quads: Object.values(quads), excluded };
}

export type MistakeRow = {
  tag: string;
  group: string;
  ids: string[];
  n: number;
  costR: number;
  rN: number;
  avgR: number | null;
};

/** Tags from "mistake" groups: how often and what they cost in R. */
export function mistakeCosts(trades: InsightTrade[], tags: TagInfo[]): MistakeRow[] {
  const mistakes = new Map(tags.filter((t) => t.kind === "mistake").map((t) => [t.id, t]));
  const out = new Map<string, MistakeRow>();
  for (const t of trades) {
    for (const id of t.tag_ids ?? []) {
      const tag = mistakes.get(id);
      if (!tag) continue;
      const row = out.get(id) ?? {
        tag: tag.name,
        group: tag.group,
        ids: [],
        n: 0,
        costR: 0,
        rN: 0,
        avgR: null,
      };
      row.ids.push(t.id);
      row.n++;
      if (t.r_multiple !== null) {
        row.costR = round(row.costR + Number(t.r_multiple));
        row.rN++;
      }
      out.set(id, row);
    }
  }
  return [...out.values()]
    .map((r) => ({ ...r, avgR: r.rN ? round(r.costR / r.rN) : null }))
    .sort((a, b) => a.costR - b.costR || b.n - a.n);
}

/** Debrief rule checks per ISO week: violations / checks answered. */
export function ruleViolationsByWeek(
  checks: RuleCheckFact[],
  weekOf: (date: string) => string,
): { week: string; checks: number; violations: number; rules: Record<string, number> }[] {
  const m = new Map<
    string,
    { week: string; checks: number; violations: number; rules: Record<string, number> }
  >();
  for (const c of checks) {
    if (c.followed === null) continue;
    const w = weekOf(c.date);
    const row = m.get(w) ?? { week: w, checks: 0, violations: 0, rules: {} };
    row.checks++;
    if (!c.followed) {
      row.violations++;
      row.rules[c.rule] = (row.rules[c.rule] ?? 0) + 1;
    }
    m.set(w, row);
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

// ---------------------------------------------------------------------------
// Plan accuracy
// ---------------------------------------------------------------------------

export type RateRow = {
  key: string;
  label: string;
  hits: number;
  n: number;
  rate: number | null;
  ci: Interval | null;
};

export function scenarioOutcomes(scenarios: ScenarioFact[]): {
  graded: number;
  ungraded: number;
  rows: {
    outcome: "played" | "partial" | "didnt";
    total: number;
    traded: number;
    notTraded: number;
    unknown: number;
  }[];
  hit: RateRow;
} {
  const graded = scenarios.filter((s) => s.outcome !== null);
  const rowsOut = (["played", "partial", "didnt"] as const).map((o) => {
    const list = graded.filter((s) => s.outcome === o);
    return {
      outcome: o,
      total: list.length,
      traded: list.filter((s) => s.traded === true).length,
      notTraded: list.filter((s) => s.traded === false).length,
      unknown: list.filter((s) => s.traded === null).length,
    };
  });
  const hits = graded.filter((s) => s.outcome === "played").length;
  return {
    graded: graded.length,
    ungraded: scenarios.length - graded.length,
    rows: rowsOut,
    hit: {
      key: "played",
      label: "Played out",
      hits,
      n: graded.length,
      rate: graded.length ? hits / graded.length : null,
      ci: wilson(hits, graded.length),
    },
  };
}

/** Respect rate of tested key levels, grouped by type or strength. */
export function levelRespect(levels: LevelFact[], by: "type" | "strength"): RateRow[] {
  const tested = levels.filter((l) => l.tested === true && l.respected !== null);
  const g = new Map<string, LevelFact[]>();
  for (const l of tested) {
    const k = by === "type" ? l.level_type : String(l.strength);
    g.set(k, [...(g.get(k) ?? []), l]);
  }
  const label = (k: string) =>
    by === "type"
      ? k
      : (({ "1": "Weak", "2": "Medium", "3": "Strong" } as Record<string, string>)[k] ?? k);
  return [...g.entries()]
    .map(([k, ls]) => {
      const hits = ls.filter((l) => l.respected).length;
      return {
        key: k,
        label: label(k),
        hits,
        n: ls.length,
        rate: hits / ls.length,
        ci: wilson(hits, ls.length),
      };
    })
    .sort((a, b) => (by === "strength" ? b.key.localeCompare(a.key) : b.n - a.n));
}

/** Trades linked to the plan (a scenario or a key level) vs not. */
export function planAlignment(trades: InsightTrade[]): Row[] {
  const g = group(trades, (t) => [t.scenario_id || t.key_level_id ? "linked" : "unlinked"]);
  return rows(g, (k) => (k === "linked" ? "Linked to the plan" : "Not linked"), [
    "linked",
    "unlinked",
  ]);
}
