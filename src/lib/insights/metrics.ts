/**
 * Honest trade statistics. R only over trades that have one (a stop was set),
 * money per currency (never mixed), always with n and 95% intervals.
 */
import type { InsightTrade } from "./types";

export type Interval = { lo: number; hi: number };

export type Metrics = {
  n: number;
  /** Trades with an R (had a stop): the n behind every R statistic. */
  rN: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winCI: Interval | null;
  netR: number;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancy: number | null;
  expCI: Interval | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  byCurrency: Record<string, number>;
  maxDrawdown: Record<string, number>;
  longestWin: number;
  longestLoss: number;
};

const Z = 1.959964;

export function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f;
}

/** Wilson score interval for a proportion (95%). */
export function wilson(successes: number, n: number): Interval | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Small, fast, seeded PRNG so bootstrap intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95% interval of the mean (seeded, B resamples). */
export function bootstrapMean(values: number[], B = 1000, seed = 42): Interval | null {
  const n = values.length;
  if (n < 2) return null;
  const rand = mulberry32(seed);
  const means = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)];
    means[b] = s / n;
  }
  means.sort();
  return { lo: means[Math.floor(0.025 * (B - 1))], hi: means[Math.ceil(0.975 * (B - 1))] };
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Deepest peak-to-trough fall of a cumulative series starting at 0 (≤ 0). */
export function maxDrawdown(steps: number[]): number {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const s of steps) {
    cum += s;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
  }
  return dd;
}

/** Outcome of a trade: money first, R for trades without money (never observed). */
export function outcome(t: InsightTrade): number | null {
  if (t.net_pnl !== null) return Number(t.net_pnl);
  if (t.r_multiple !== null) return Number(t.r_multiple);
  return null;
}

/** Longest runs of wins and losses in entry order; a scratch breaks both. */
export function streaks(outcomes: number[]): { win: number; loss: number } {
  let win = 0;
  let loss = 0;
  let w = 0;
  let l = 0;
  for (const o of outcomes) {
    w = o > 0 ? w + 1 : 0;
    l = o < 0 ? l + 1 : 0;
    win = Math.max(win, w);
    loss = Math.max(loss, l);
  }
  return { win, loss };
}

export function byEntry(trades: InsightTrade[]): InsightTrade[] {
  return [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
}

export function rValues(trades: InsightTrade[]): number[] {
  return trades.filter((t) => t.r_multiple !== null).map((t) => Number(t.r_multiple));
}

/**
 * Full metric set. `withCI: false` skips the bootstrap (used while mining
 * thousands of combinations; intervals are added for the rows shown).
 */
export function computeMetrics(trades: InsightTrade[], opts: { withCI?: boolean } = {}): Metrics {
  const ordered = byEntry(trades);
  const rs = rValues(ordered);
  const outcomes = ordered.map(outcome).filter((o): o is number => o !== null);
  const wins = outcomes.filter((o) => o > 0).length;
  const losses = outcomes.filter((o) => o < 0).length;
  const decided = wins + losses;
  const winRs = rs.filter((r) => r > 0);
  const lossRs = rs.filter((r) => r < 0);
  const gains = winRs.reduce((a, b) => a + b, 0);
  const pains = -lossRs.reduce((a, b) => a + b, 0);

  const byCurrency: Record<string, number> = {};
  const moneySteps: Record<string, number[]> = {};
  for (const t of ordered) {
    if (t.net_pnl === null) continue;
    byCurrency[t.currency] = round((byCurrency[t.currency] ?? 0) + Number(t.net_pnl), 4);
    (moneySteps[t.currency] ??= []).push(Number(t.net_pnl));
  }
  const maxDd: Record<string, number> = {};
  for (const [cur, steps] of Object.entries(moneySteps)) maxDd[cur] = round(maxDrawdown(steps), 2);

  const exp = mean(rs);
  const st = streaks(outcomes);
  return {
    n: trades.length,
    rN: rs.length,
    wins,
    losses,
    winRate: decided ? wins / decided : null,
    winCI: wilson(wins, decided),
    netR: round(rs.reduce((a, b) => a + b, 0)),
    avgWinR: winRs.length ? round(gains / winRs.length) : null,
    avgLossR: lossRs.length ? round(-pains / lossRs.length) : null,
    expectancy: exp === null ? null : round(exp),
    expCI: opts.withCI === false ? null : bootstrapMean(rs),
    profitFactor: pains > 0 ? round(gains / pains) : null,
    maxDrawdownR: round(maxDrawdown(rs)),
    byCurrency,
    maxDrawdown: maxDd,
    longestWin: st.win,
    longestLoss: st.loss,
  };
}

/** Cumulative series in entry order: R (trades with an R) or money of one currency. */
export function equitySeries(
  trades: InsightTrade[],
  unit: "R" | string,
): { id: string; at: string; v: number; cum: number; label: string }[] {
  let cum = 0;
  return byEntry(trades)
    .filter((t) =>
      unit === "R" ? t.r_multiple !== null : t.currency === unit && t.net_pnl !== null,
    )
    .map((t) => {
      const v = Number(unit === "R" ? t.r_multiple : t.net_pnl);
      cum = round(cum + v, 4);
      return {
        id: t.id,
        at: t.entry_at,
        v,
        cum,
        label: `${t.symbol} ${t.direction === "long" ? "L" : "S"}`,
      };
    });
}

export const R_BINS: { label: string; min: number; max: number }[] = [
  { label: "≤ −2R", min: -Infinity, max: -2 },
  { label: "−2…−1", min: -2, max: -1 },
  { label: "−1…0", min: -1, max: 0 },
  { label: "0…1", min: 0, max: 1 },
  { label: "1…2", min: 1, max: 2 },
  { label: "2…3", min: 2, max: 3 },
  { label: "≥ 3R", min: 3, max: Infinity },
];

/** R histogram with the trade ids of each bin (for click-through). */
export function rHistogram(trades: InsightTrade[]): { label: string; ids: string[] }[] {
  return R_BINS.map((b) => ({
    label: b.label,
    ids: trades
      .filter((t) => t.r_multiple !== null && t.r_multiple >= b.min && t.r_multiple < b.max)
      .map((t) => t.id),
  }));
}
