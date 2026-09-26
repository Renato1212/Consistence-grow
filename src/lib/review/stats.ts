/**
 * Day and week aggregation for debriefs and weekly reviews. Honest by
 * construction: R only over trades that had a stop (n shown), money summed
 * per currency (never mixed), missed/observed never counted as P&L.
 */
export type FactTrade = {
  id: string;
  kind: "taken" | "missed" | "observed";
  trade_date: string;
  entry_at: string;
  symbol: string;
  direction: "long" | "short";
  net_pnl: number | null;
  r_multiple: number | null;
  currency: string;
  primary_domain: string | null;
  playbook_name: string | null;
  grade_process: string | null;
};

export type Summary = {
  n: number; // taken trades
  wins: number;
  losses: number;
  winRate: number | null; // wins / decided (net ≠ 0)
  netR: number;
  rN: number; // trades with an R
  byCurrency: Record<string, number>;
  best: FactTrade | null; // by R, else by money
  worst: FactTrade | null;
};

export const MIN_N_SHOW = 10; // grey out below
export const MIN_N_TRUST = 20; // "insufficient data" badge below

function score(t: FactTrade): number | null {
  return t.r_multiple ?? null;
}

export function summarize(trades: FactTrade[]): Summary {
  const taken = trades.filter((t) => t.kind === "taken");
  const s: Summary = {
    n: taken.length,
    wins: 0,
    losses: 0,
    winRate: null,
    netR: 0,
    rN: 0,
    byCurrency: {},
    best: null,
    worst: null,
  };
  for (const t of taken) {
    if (t.net_pnl !== null) {
      const v = Number(t.net_pnl);
      s.byCurrency[t.currency] = (s.byCurrency[t.currency] ?? 0) + v;
      if (v > 0) s.wins++;
      else if (v < 0) s.losses++;
    }
    if (t.r_multiple !== null) {
      s.netR += Number(t.r_multiple);
      s.rN++;
    }
  }
  s.netR = Math.round(s.netR * 100) / 100;
  const decided = s.wins + s.losses;
  s.winRate = decided > 0 ? s.wins / decided : null;
  const withR = taken.filter((t) => score(t) !== null);
  if (withR.length) {
    s.best = withR.reduce((a, b) => (score(b)! > score(a)! ? b : a));
    s.worst = withR.reduce((a, b) => (score(b)! < score(a)! ? b : a));
  }
  return s;
}

export type BreakdownRow = {
  key: string;
  n: number;
  netR: number;
  rN: number;
  winRate: number | null;
};

/** Group taken trades by a key (domain, playbook…), sorted by net R. */
export function breakdown(
  trades: FactTrade[],
  keyOf: (t: FactTrade) => string | null,
  emptyLabel = "—",
): BreakdownRow[] {
  const groups = new Map<string, FactTrade[]>();
  for (const t of trades) {
    if (t.kind !== "taken") continue;
    const k = keyOf(t) ?? emptyLabel;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const s = summarize(list);
      return { key, n: s.n, netR: s.netR, rN: s.rN, winRate: s.winRate };
    })
    .sort((a, b) => b.netR - a.netR || b.n - a.n);
}

/** Cumulative R, one point per trade with an R, in entry order. */
export function equityCurve(
  trades: FactTrade[],
): { id: string; at: string; r: number; cum: number }[] {
  let cum = 0;
  return trades
    .filter((t) => t.kind === "taken" && t.r_multiple !== null)
    .sort((a, b) => a.entry_at.localeCompare(b.entry_at))
    .map((t) => {
      cum = Math.round((cum + Number(t.r_multiple)) * 100) / 100;
      return { id: t.id, at: t.entry_at, r: Number(t.r_multiple), cum };
    });
}

const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, F: 1 };

/** Top and bottom `k` taken trades by R and by process grade. */
export function extremes(trades: FactTrade[], k = 3) {
  const withR = trades
    .filter((t) => t.kind === "taken" && t.r_multiple !== null)
    .sort((a, b) => Number(b.r_multiple) - Number(a.r_multiple));
  const graded = trades
    .filter((t) => t.kind === "taken" && t.grade_process && GRADE_RANK[t.grade_process])
    .sort(
      (a, b) =>
        GRADE_RANK[b.grade_process!] - GRADE_RANK[a.grade_process!] ||
        Number(b.r_multiple ?? 0) - Number(a.r_multiple ?? 0),
    );
  const bottom = <T>(list: T[]) => list.slice(Math.max(k, list.length - k)).reverse();
  return {
    topR: withR.slice(0, k),
    bottomR: bottom(withR),
    topProcess: graded.slice(0, k),
    bottomProcess: bottom(graded),
  };
}

/** "insufficient" (< 20), "weak" (< 10) or "ok" — drives badges and greying. */
export function sampleQuality(n: number): "weak" | "insufficient" | "ok" {
  if (n < MIN_N_SHOW) return "weak";
  if (n < MIN_N_TRUST) return "insufficient";
  return "ok";
}
