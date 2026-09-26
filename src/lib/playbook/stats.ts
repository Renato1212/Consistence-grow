import { summarize, type FactTrade, type Summary } from "@/lib/review/stats";

export type PlaybookTrade = FactTrade & {
  playbook_version: number | null;
  time_bucket: string | null;
  minutes_from_event: number | null;
  checklist: Record<string, boolean>;
  media_count: number;
};

export type Bucket = { key: string; n: number; netR: number; rN: number; winRate: number | null };

export type PlaybookStats = Summary & {
  avgR: number | null; // = expectancy in R per trade (trades with a stop)
  profitFactor: number | null; // gross positive R / gross negative R
  histogram: { label: string; n: number }[];
  byInstrument: Bucket[];
  byTime: Bucket[];
  byEvent: Bucket[];
  grades: { grade: string; n: number }[];
  checklist: { n: number; complete: number; avgTicked: number | null };
  lastTraded: string | null;
};

export const R_BINS: { label: string; min: number; max: number }[] = [
  { label: "≤ −2R", min: -Infinity, max: -2 },
  { label: "−2…−1", min: -2, max: -1 },
  { label: "−1…0", min: -1, max: 0 },
  { label: "0…1", min: 0, max: 1 },
  { label: "1…2", min: 1, max: 2 },
  { label: "2…3", min: 2, max: 3 },
  { label: "≥ 3R", min: 3, max: Infinity },
];

/** Minutes relative to the linked event: the same buckets Insights will use. */
export function eventBucket(m: number | null): string {
  if (m === null) return "No event";
  if (m < -30) return "< −30 min";
  if (m < 0) return "−30…0 min";
  if (m < 5) return "0–5 min";
  if (m < 15) return "5–15 min";
  if (m < 60) return "15–60 min";
  return "> 60 min";
}
const EVENT_ORDER = [
  "< −30 min",
  "−30…0 min",
  "0–5 min",
  "5–15 min",
  "15–60 min",
  "> 60 min",
  "No event",
];

function group(trades: PlaybookTrade[], keyOf: (t: PlaybookTrade) => string): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const t of trades) {
    const k = keyOf(t);
    const s = summarize(trades.filter((x) => keyOf(x) === k));
    m.set(k, { key: k, n: s.n, netR: s.netR, rN: s.rN, winRate: s.winRate });
  }
  return m;
}

export function playbookStats(all: PlaybookTrade[]): PlaybookStats {
  const trades = all.filter((t) => t.kind === "taken");
  const s = summarize(trades);
  const rs = trades.map((t) => t.r_multiple).filter((r): r is number => r !== null);
  const gains = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);

  const histogram = R_BINS.map((b) => ({
    label: b.label,
    n: rs.filter((r) => r >= b.min && r < b.max).length,
  }));

  const byTime = [...group(trades, (t) => t.time_bucket ?? "—").values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const byEvent = [...group(trades, (t) => eventBucket(t.minutes_from_event)).values()].sort(
    (a, b) => EVENT_ORDER.indexOf(a.key) - EVENT_ORDER.indexOf(b.key),
  );
  const byInstrument = [...group(trades, (t) => t.symbol).values()].sort((a, b) => b.n - a.n);

  const grades = ["A", "B", "C", "F"].map((g) => ({
    grade: g,
    n: trades.filter((t) => t.grade_process === g).length,
  }));

  const withChecklist = trades.filter((t) => Object.keys(t.checklist ?? {}).length > 0);
  const fractions = withChecklist.map((t) => {
    const v = Object.values(t.checklist);
    return v.filter(Boolean).length / v.length;
  });

  return {
    ...s,
    avgR: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 : null,
    profitFactor: losses > 0 ? Math.round((gains / losses) * 100) / 100 : null,
    histogram,
    byInstrument,
    byTime,
    byEvent,
    grades,
    checklist: {
      n: withChecklist.length,
      complete: fractions.filter((f) => f === 1).length,
      avgTicked: fractions.length ? fractions.reduce((a, b) => a + b, 0) / fractions.length : null,
    },
    lastTraded: trades.length
      ? trades
          .map((t) => t.entry_at)
          .sort()
          .at(-1)!
      : null,
  };
}

const RANK: Record<string, number> = { A: 0, B: 1, C: 2, F: 3 };

/** Example trades: A-process first, then by R, only trades with media. */
export function exampleOrder(trades: PlaybookTrade[]): PlaybookTrade[] {
  return trades
    .filter((t) => t.media_count > 0)
    .sort(
      (a, b) =>
        (RANK[a.grade_process ?? ""] ?? 9) - (RANK[b.grade_process ?? ""] ?? 9) ||
        Number(b.r_multiple ?? -99) - Number(a.r_multiple ?? -99),
    );
}
