/**
 * Weekly scorecard per setup: the week's trades and plan adherence next to
 * the setup's all-time record (with 95% intervals), so keep / tweak / drop
 * is never decided on a handful of trades.
 */
import { bootstrapMean, wilson, type Interval } from "@/lib/insights/metrics";

export type ScoreTrade = {
  playbookId: string | null;
  tradeDate: string;
  net: number | null;
  r: number | null;
};

export type SetupStats = {
  n: number;
  wins: number;
  /** Wins / decided trades (net ≠ 0). */
  winRate: number | null;
  winCI: Interval | null;
  avgR: number | null;
  avgRCI: Interval | null;
  rN: number;
  net: number;
};

export function setupStats(trades: ScoreTrade[]): SetupStats {
  const decided = trades.filter((t) => t.net !== null && t.net !== 0);
  const wins = decided.filter((t) => (t.net ?? 0) > 0).length;
  const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;
  return {
    n: trades.length,
    wins,
    winRate: decided.length ? wins / decided.length : null,
    winCI: wilson(wins, decided.length),
    avgR,
    avgRCI: bootstrapMean(rs),
    rN: rs.length,
    net: Math.round(trades.reduce((s, t) => s + (t.net ?? 0), 0) * 100) / 100,
  };
}

export type Adherence = { yes: number; partly: number; no: number; answered: number };

export function adherence(answers: ("yes" | "partly" | "no" | null)[]): Adherence {
  const out = { yes: 0, partly: 0, no: 0, answered: 0 };
  for (const a of answers) {
    if (!a) continue;
    out[a]++;
    out.answered++;
  }
  return out;
}

export type Verdict = "keep" | "tweak" | "drop";
export type SetupNote = { verdict: Verdict | null; note: string };

/** Notes stored per playbook id in weekly_reviews.setup_notes (unknown shapes ignored). */
export function parseSetupNotes(raw: unknown): Record<string, SetupNote> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SetupNote> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as { verdict?: unknown; note?: unknown };
    const verdict =
      o.verdict === "keep" || o.verdict === "tweak" || o.verdict === "drop" ? o.verdict : null;
    out[id] = { verdict, note: typeof o.note === "string" ? o.note.slice(0, 500) : "" };
  }
  return out;
}
