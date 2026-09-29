/**
 * Day-level analytics on broker statements: the account's real P/L per day
 * and per product, volume vs results, reconciliation against the journal and
 * the link with the trader's process (prep, readiness, rules, events).
 * Always with n (days) and 95% intervals; days are the unit, never trades.
 */
import { bootstrapMean, maxDrawdown, mean, round, streaks, wilson } from "@/lib/insights/metrics";
import type { Interval } from "@/lib/insights/metrics";

import { multiplierMatches } from "./products";
import type { NlvPoint } from "./types";

export type DayProduct = {
  code: string;
  contract: string;
  description: string;
  instrumentId: string | null;
  symbol: string | null;
  tickSize: number | null;
  tickValue: number | null;
  priceScale: number;
  impliedMultiplier: number | null;
  longQty: number;
  shortQty: number;
  fills: number;
  realized: number | null;
};

export type StatementDay = {
  id: string;
  account: string;
  tradeDate: string;
  realized: number;
  fees: number;
  net: number;
  nlv: number | null;
  contracts: number;
  fills: number;
  status: "ok" | "attention";
  simulated: boolean;
  nlvHistory: NlvPoint[];
  products: DayProduct[];
};

export type JournalTrade = {
  id: string;
  tradingDay: string;
  instrumentId: string;
  symbol: string;
  grossPnl: number | null;
  contracts: number;
};

export type DayContext = {
  prepDone: boolean;
  readiness: number | null; // 1–5
  rulesFollowed: number | null; // 0–1, debrief rule checks
  processGrade: "A" | "B" | "C" | "F" | null;
  highImpactEvent: boolean;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byDate = (a: StatementDay, b: StatementDay) => a.tradeDate.localeCompare(b.tradeDate);

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export type GroupStats = {
  n: number;
  net: number;
  mean: number | null;
  meanCI: Interval | null;
  wins: number;
  winRate: number | null;
  winCI: Interval | null;
};

export function groupStats(values: number[]): GroupStats {
  const wins = values.filter((v) => v > 0).length;
  const decided = values.filter((v) => v !== 0).length;
  return {
    n: values.length,
    net: round(sum(values)),
    mean: mean(values) === null ? null : round(mean(values)!),
    meanCI: bootstrapMean(values),
    wins,
    winRate: decided ? wins / decided : null,
    winCI: wilson(wins, decided),
  };
}

export type AccountStats = GroupStats & {
  losses: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  best: { date: string; net: number } | null;
  worst: { date: string; net: number } | null;
  maxDrawdown: number;
  longestWin: number;
  longestLoss: number;
  fees: number;
  contracts: number;
  avgContracts: number | null;
};

export function accountStats(days: StatementDay[]): AccountStats {
  const sorted = days.toSorted(byDate);
  const nets = sorted.map((d) => d.net);
  const winsV = nets.filter((v) => v > 0);
  const lossV = nets.filter((v) => v < 0);
  const s = streaks(nets);
  const best = sorted.reduce<StatementDay | null>((b, d) => (!b || d.net > b.net ? d : b), null);
  const worst = sorted.reduce<StatementDay | null>((b, d) => (!b || d.net < b.net ? d : b), null);
  return {
    ...groupStats(nets),
    losses: lossV.length,
    avgWin: winsV.length ? round(mean(winsV)!) : null,
    avgLoss: lossV.length ? round(mean(lossV)!) : null,
    profitFactor: lossV.length ? round(sum(winsV) / Math.abs(sum(lossV))) : null,
    best: best ? { date: best.tradeDate, net: best.net } : null,
    worst: worst ? { date: worst.tradeDate, net: worst.net } : null,
    maxDrawdown: round(maxDrawdown(nets)),
    longestWin: s.win,
    longestLoss: s.loss,
    fees: round(sum(sorted.map((d) => d.fees))),
    contracts: sum(sorted.map((d) => d.contracts)),
    avgContracts: sorted.length
      ? round(sum(sorted.map((d) => d.contracts)) / sorted.length, 1)
      : null,
  };
}

export type CurvePoint = { date: string; cum: number; nlv: number | null; net: number };

export function equityCurve(days: StatementDay[]): CurvePoint[] {
  let cum = 0;
  return days.toSorted(byDate).map((d) => {
    cum += d.net;
    return { date: d.tradeDate, cum: round(cum), nlv: d.nlv, net: d.net };
  });
}

/**
 * Statements missing between two uploaded days: the later statement's T-1 NLV
 * should equal the earlier statement's NLV.
 */
export function continuityGaps(days: StatementDay[]): { after: string; before: string }[] {
  const out: { after: string; before: string }[] = [];
  const sorted = days.toSorted(byDate);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const t1 = cur.nlvHistory.find((p) => p.offset === -1);
    if (!t1 || prev.nlv === null || prev.account !== cur.account) continue;
    if (Math.abs(t1.nlv - prev.nlv) > 0.01)
      out.push({ after: prev.tradeDate, before: cur.tradeDate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export type ProductRow = {
  key: string; // symbol, or the broker code when unmapped
  symbol: string | null;
  codes: string[];
  description: string;
  days: number;
  net: number;
  share: number | null; // of the absolute total
  contracts: number;
  roundTurns: number;
  perContract: number | null; // P/L per round turn
  winDays: number;
  winRate: number | null;
  winCI: Interval | null;
  avgContractsPerDay: number;
  best: number;
  worst: number;
  mappingOk: boolean | null;
};

export function productKey(p: DayProduct) {
  return p.symbol ?? `code ${p.code}`;
}

export function productStats(days: StatementDay[]): ProductRow[] {
  const groups = new Map<string, { p: DayProduct; date: string }[]>();
  for (const d of days)
    for (const p of d.products) {
      const k = productKey(p);
      groups.set(k, [...(groups.get(k) ?? []), { p, date: d.tradeDate }]);
    }
  const totalAbs = sum(
    [...groups.values()].map((g) => Math.abs(sum(g.map((x) => x.p.realized ?? 0)))),
  );
  const rows = [...groups.entries()].map(([key, g]) => {
    // One value per day (a day can hold two contract months of one product).
    const perDay = new Map<string, number>();
    for (const x of g) perDay.set(x.date, (perDay.get(x.date) ?? 0) + (x.p.realized ?? 0));
    const dayNets = [...perDay.values()];
    const net = round(sum(dayNets));
    const contracts = sum(g.map((x) => x.p.longQty + x.p.shortQty));
    const roundTurns = sum(g.map((x) => Math.min(x.p.longQty, x.p.shortQty)));
    const wins = dayNets.filter((v) => v > 0).length;
    const decided = dayNets.filter((v) => v !== 0).length;
    const first = g[0].p;
    const checks = g.map((x) =>
      x.p.tickSize && x.p.tickValue
        ? multiplierMatches(
            x.p.impliedMultiplier,
            { tickSize: x.p.tickSize, tickValue: x.p.tickValue },
            x.p.priceScale,
          )
        : null,
    );
    return {
      key,
      symbol: first.symbol,
      codes: [...new Set(g.map((x) => x.p.code))],
      description: first.description,
      days: perDay.size,
      net,
      share: totalAbs ? Math.abs(net) / totalAbs : null,
      contracts,
      roundTurns,
      perContract: roundTurns ? round(net / roundTurns) : null,
      winDays: wins,
      winRate: decided ? wins / decided : null,
      winCI: wilson(wins, decided),
      avgContractsPerDay: round(contracts / perDay.size, 1),
      best: Math.max(...dayNets),
      worst: Math.min(...dayNets),
      mappingOk: checks.includes(false) ? false : checks.includes(true) ? true : null,
    };
  });
  return rows.toSorted((a, b) => b.net - a.net);
}

// ---------------------------------------------------------------------------
// Size / overtrading lens
// ---------------------------------------------------------------------------
export type BucketRow = GroupStats & { label: string; dates: string[] };

/** Days split into volume terciles (by contracts traded that day). */
export function sizeBuckets(days: StatementDay[]): BucketRow[] {
  if (days.length < 3) return [];
  const sorted = days.toSorted((a, b) => a.contracts - b.contracts);
  const cut1 = sorted[Math.floor(sorted.length / 3)].contracts;
  const cut2 = sorted[Math.floor((2 * sorted.length) / 3)].contracts;
  const buckets: { label: string; test: (c: number) => boolean }[] = [
    { label: `Light (< ${cut1} contracts)`, test: (c) => c < cut1 },
    { label: `Normal (${cut1}–${Math.max(cut1, cut2 - 1)})`, test: (c) => c >= cut1 && c < cut2 },
    { label: `Heavy (≥ ${cut2})`, test: (c) => c >= cut2 },
  ];
  return buckets
    .map((b) => {
      const mine = days.filter((d) => b.test(d.contracts));
      return {
        label: b.label,
        dates: mine.map((d) => d.tradeDate),
        ...groupStats(mine.map((d) => d.net)),
      };
    })
    .filter((b) => b.n > 0);
}

export type ScatterPoint = { date: string; key: string; contracts: number; pnl: number };

export function productDayPoints(days: StatementDay[]): ScatterPoint[] {
  return days.flatMap((d) =>
    d.products.map((p) => ({
      date: d.tradeDate,
      key: productKey(p),
      contracts: p.longQty + p.shortQty,
      pnl: p.realized ?? 0,
    })),
  );
}

/**
 * Rank correlation (Spearman) between volume and P/L across days; negative
 * means bigger days tend to be worse. Null below 5 days.
 */
export function volumeCorrelation(days: StatementDay[]): number | null {
  if (days.length < 5) return null;
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).toSorted((a, b) => a[0] - b[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const a = rank(days.map((d) => d.contracts));
  const b = rank(days.map((d) => d.net));
  const ma = mean(a)!;
  const mb = mean(b)!;
  const cov = sum(a.map((v, i) => (v - ma) * (b[i] - mb)));
  const va = Math.sqrt(sum(a.map((v) => (v - ma) ** 2)));
  const vb = Math.sqrt(sum(b.map((v) => (v - mb) ** 2)));
  return va && vb ? round(cov / (va * vb)) : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayRows(days: StatementDay[]): BucketRow[] {
  const rows: BucketRow[] = [];
  for (const wd of [1, 2, 3, 4, 5]) {
    const mine = days.filter((d) => new Date(`${d.tradeDate}T12:00:00Z`).getUTCDay() === wd);
    if (mine.length)
      rows.push({
        label: WEEKDAYS[wd],
        dates: mine.map((d) => d.tradeDate),
        ...groupStats(mine.map((d) => d.net)),
      });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Process lens: broker P/L per day grouped by the day's process data
// ---------------------------------------------------------------------------
export type ProcessGroup = { dimension: string; rows: BucketRow[] };

export function processLens(days: StatementDay[], ctx: Map<string, DayContext>): ProcessGroup[] {
  const group = (
    dimension: string,
    labelOf: (c: DayContext | undefined) => string | null,
    order: string[],
  ): ProcessGroup => {
    const rows = order
      .map((label) => {
        const mine = days.filter((d) => labelOf(ctx.get(d.tradeDate)) === label);
        return {
          label,
          dates: mine.map((d) => d.tradeDate),
          ...groupStats(mine.map((d) => d.net)),
        };
      })
      .filter((r) => r.n > 0);
    return { dimension, rows };
  };
  return [
    group("Prep", (c) => (c?.prepDone ? "Prep done" : "No prep"), ["Prep done", "No prep"]),
    group(
      "Readiness",
      (c) =>
        c?.readiness == null
          ? null
          : c.readiness >= 4
            ? "High (≥ 4)"
            : c.readiness >= 3
              ? "Medium (3–4)"
              : "Low (< 3)",
      ["High (≥ 4)", "Medium (3–4)", "Low (< 3)"],
    ),
    group(
      "Rules (debrief)",
      (c) =>
        c?.rulesFollowed == null ? null : c.rulesFollowed >= 1 ? "All followed" : "Some broken",
      ["All followed", "Some broken"],
    ),
    group(
      "Process grade",
      (c) => (c?.processGrade ? (["A", "B"].includes(c.processGrade) ? "A/B" : "C/F") : null),
      ["A/B", "C/F"],
    ),
    group(
      "High-impact event",
      (c) => (c ? (c.highImpactEvent ? "Event day" : "No event") : "No event"),
      ["Event day", "No event"],
    ),
  ].filter((g) => g.rows.length > 0);
}

// ---------------------------------------------------------------------------
// Reconciliation with the journal
// ---------------------------------------------------------------------------
export type ReconStatus = "matched" | "differs" | "missing" | "unmapped" | "extra";

export type ReconRow = {
  date: string;
  statementId: string | null;
  key: string;
  code: string | null;
  instrumentId: string | null;
  broker: number | null;
  brokerContracts: number;
  journal: number | null;
  journalTrades: string[];
  diff: number | null;
  status: ReconStatus;
};

export const RECON_TOLERANCE = 1; // USD: treasury amounts are rounded per line

export function reconcile(days: StatementDay[], trades: JournalTrade[]): ReconRow[] {
  const rows: ReconRow[] = [];
  const statementDates = new Set(days.map((d) => d.tradeDate));
  const byDayInst = new Map<string, JournalTrade[]>();
  for (const t of trades) {
    if (!statementDates.has(t.tradingDay)) continue;
    const k = `${t.tradingDay}|${t.instrumentId}`;
    byDayInst.set(k, [...(byDayInst.get(k) ?? []), t]);
  }
  const used = new Set<string>();
  for (const d of days.toSorted(byDate)) {
    // Merge contract months of the same instrument (e.g. a roll day).
    const merged = new Map<string, DayProduct[]>();
    for (const p of d.products) {
      const k = p.instrumentId ?? `code:${p.code}`;
      merged.set(k, [...(merged.get(k) ?? []), p]);
    }
    for (const [k, ps] of merged) {
      const broker = round(sum(ps.map((p) => p.realized ?? 0)));
      const brokerContracts = sum(ps.map((p) => p.longQty + p.shortQty));
      const base = {
        date: d.tradeDate,
        statementId: d.id,
        key: productKey(ps[0]),
        code: ps[0].code,
        instrumentId: ps[0].instrumentId,
        broker,
        brokerContracts,
      };
      if (!ps[0].instrumentId) {
        rows.push({ ...base, journal: null, journalTrades: [], diff: null, status: "unmapped" });
        continue;
      }
      const jk = `${d.tradeDate}|${k}`;
      used.add(jk);
      const mine = byDayInst.get(jk) ?? [];
      if (!mine.length) {
        rows.push({ ...base, journal: null, journalTrades: [], diff: null, status: "missing" });
        continue;
      }
      const journal = round(sum(mine.map((t) => t.grossPnl ?? 0)));
      const diff = round(journal - broker);
      rows.push({
        ...base,
        journal,
        journalTrades: mine.map((t) => t.id),
        diff,
        status: Math.abs(diff) <= RECON_TOLERANCE ? "matched" : "differs",
      });
    }
  }
  for (const [k, mine] of byDayInst) {
    if (used.has(k)) continue;
    const journal = round(sum(mine.map((t) => t.grossPnl ?? 0)));
    rows.push({
      date: mine[0].tradingDay,
      statementId: days.find((d) => d.tradeDate === mine[0].tradingDay)?.id ?? null,
      key: mine[0].symbol,
      code: null,
      instrumentId: mine[0].instrumentId,
      broker: null,
      brokerContracts: 0,
      journal,
      journalTrades: mine.map((t) => t.id),
      diff: journal,
      status: "extra",
    });
  }
  return rows.toSorted((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export type ReconSummary = {
  total: number; // broker product-days
  matched: number;
  differs: number;
  missing: number;
  unmapped: number;
  extra: number;
  completeness: number | null; // matched / total
};

export function reconSummary(rows: ReconRow[]): ReconSummary {
  const count = (s: ReconStatus) => rows.filter((r) => r.status === s).length;
  const total = rows.filter((r) => r.status !== "extra").length;
  return {
    total,
    matched: count("matched"),
    differs: count("differs"),
    missing: count("missing"),
    unmapped: count("unmapped"),
    extra: count("extra"),
    completeness: total ? count("matched") / total : null,
  };
}

/**
 * How many of a set of journal trades sit on broker-verified product-days:
 * a statement exists for the day, and that product's journal P/L matches it.
 */
export function verifyTrades(
  trades: { id: string; date: string; symbol: string }[],
  rows: ReconRow[],
): { total: number; covered: number; verified: number } {
  const statementDates = new Set(rows.filter((r) => r.statementId).map((r) => r.date));
  const matched = new Set(
    rows.filter((r) => r.status === "matched").map((r) => `${r.date}|${r.key}`),
  );
  return {
    total: trades.length,
    covered: trades.filter((t) => statementDates.has(t.date)).length,
    verified: trades.filter((t) => matched.has(`${t.date}|${t.symbol}`)).length,
  };
}
