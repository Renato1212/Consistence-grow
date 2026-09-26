import { roundHalfAway } from "@/lib/trading/round";

/** Daily P&L aggregation for the calendar heatmap (taken trades only). */
export type HeatmapTrade = {
  trade_date: string | null; // Lisbon calendar date (yyyy-MM-dd)
  kind: string;
  net_pnl: number | null;
  r_multiple: number | null;
  currency: string;
};

export type DayCell = {
  date: string;
  n: number;
  /** Sum of R over trades that have an R (had a stop). */
  netR: number;
  rN: number;
  /** Net P&L per currency (USD and EUR are never added together). */
  net: Record<string, number>;
};

export function aggregateDaily(trades: HeatmapTrade[]): Map<string, DayCell> {
  const days = new Map<string, DayCell>();
  for (const t of trades) {
    if (t.kind !== "taken" || !t.trade_date || t.net_pnl === null) continue;
    const cell = days.get(t.trade_date) ?? { date: t.trade_date, n: 0, netR: 0, rN: 0, net: {} };
    cell.n++;
    cell.net[t.currency] = roundHalfAway((cell.net[t.currency] ?? 0) + Number(t.net_pnl), 4);
    if (t.r_multiple !== null) {
      cell.netR = roundHalfAway(cell.netR + Number(t.r_multiple), 4);
      cell.rN++;
    }
    days.set(t.trade_date, cell);
  }
  return days;
}

/** Weeks (Mon–Sun) covering a month; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 0..1 intensity for a day's money result relative to the month's largest absolute day. */
export function intensity(value: number, maxAbs: number): number {
  if (!maxAbs || !value) return 0;
  return Math.min(1, Math.abs(value) / maxAbs);
}
