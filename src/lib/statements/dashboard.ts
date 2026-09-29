/** Everything the statements dashboard shows, computed once on the server. */
import {
  accountStats,
  continuityGaps,
  equityCurve,
  processLens,
  productDayPoints,
  productStats,
  reconSummary,
  reconcile,
  sizeBuckets,
  volumeCorrelation,
  weekdayRows,
  type AccountStats,
  type BucketRow,
  type CurvePoint,
  type DayContext,
  type JournalTrade,
  type ProcessGroup,
  type ProductRow,
  type ReconRow,
  type ReconSummary,
  type ScatterPoint,
  type StatementDay,
} from "./analysis";

export type StatementListRow = {
  id: string;
  date: string;
  net: number;
  contracts: number;
  products: string[];
  status: "ok" | "attention";
};

export type DashboardData = {
  simulated: boolean;
  stats: AccountStats;
  curve: CurvePoint[];
  ids: Record<string, string>;
  calendar: { date: string; id: string; net: number; attention: boolean }[];
  initialMonth: string;
  gaps: { after: string; before: string }[];
  attention: { id: string; date: string }[];
  unmapped: string[];
  products: ProductRow[];
  buckets: BucketRow[];
  scatter: ScatterPoint[];
  rho: number | null;
  weekdays: BucketRow[];
  process: ProcessGroup[];
  recon: ReconRow[];
  reconSummary: ReconSummary;
  list: StatementListRow[];
};

export function buildDashboard(
  days: StatementDay[],
  trades: JournalTrade[],
  ctx: Map<string, DayContext>,
): DashboardData {
  const recon = reconcile(days, trades);
  const last = days.at(-1);
  return {
    simulated: days.some((d) => d.simulated),
    stats: accountStats(days),
    curve: equityCurve(days),
    ids: Object.fromEntries(days.map((d) => [d.tradeDate, d.id])),
    calendar: days.map((d) => ({
      date: d.tradeDate,
      id: d.id,
      net: d.net,
      attention: d.status === "attention",
    })),
    initialMonth: (last?.tradeDate ?? "1970-01-01").slice(0, 7),
    gaps: continuityGaps(days),
    attention: days
      .filter((d) => d.status === "attention")
      .map((d) => ({ id: d.id, date: d.tradeDate })),
    unmapped: [
      ...new Set(days.flatMap((d) => d.products.filter((p) => !p.instrumentId).map((p) => p.code))),
    ],
    products: productStats(days),
    buckets: sizeBuckets(days),
    scatter: productDayPoints(days),
    rho: volumeCorrelation(days),
    weekdays: weekdayRows(days),
    process: processLens(days, ctx),
    recon,
    reconSummary: reconSummary(recon),
    list: days.toReversed().map((d) => ({
      id: d.id,
      date: d.tradeDate,
      net: d.net,
      contracts: d.contracts,
      products: d.products.map((p) => p.symbol ?? p.code),
      status: d.status,
    })),
  };
}
