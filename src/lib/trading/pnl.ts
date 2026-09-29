import { roundHalfAway } from "./round";
import {
  DEFAULT_SESSION_SETTINGS,
  isoWeekday,
  sessionFor,
  timeBucket,
  type Session,
  type SessionSettings,
} from "./sessions";

/**
 * Derived trade fields. Mirrors public.compute_trade() in SQL exactly
 * (same formulas, same rounding) — the DB is authoritative, this powers
 * instant previews in the trade form.
 */
export type TradeKind = "taken" | "missed" | "observed";
export type Direction = "long" | "short";

export type PnlInstrument = {
  tickSize: number;
  tickValue: number;
  feePerContract: number;
  exchangeTz: string;
};

export type TradeInput = {
  kind: TradeKind;
  direction: Direction;
  entryAt: Date | string;
  exitAt?: Date | string | null;
  entryPrice: number;
  exitPrice?: number | null;
  stopPrice?: number | null;
  contracts?: number | null;
  /** Manual fee override for the whole trade; null → instrument default × contracts. */
  fees?: number | null;
  /** Time not known (built from a broker statement): no time bucket, session or duration. */
  timeEstimated?: boolean;
};

export type TradeComputed = {
  ticks: number | null;
  feesTotal: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  riskUsd: number | null;
  rMultiple: number | null;
  noStop: boolean;
  durationSec: number | null;
  weekday: number;
  timeBucket: string | null;
  session: Session | null;
};

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function computeTrade(
  inst: PnlInstrument,
  t: TradeInput,
  settings: SessionSettings = DEFAULT_SESSION_SETTINGS,
): TradeComputed {
  const dir = t.direction === "long" ? 1 : -1;
  const isTrade = t.kind !== "observed";

  const ticks = isNum(t.exitPrice)
    ? roundHalfAway(((t.exitPrice - t.entryPrice) * dir) / inst.tickSize, 6)
    : null;

  const feesTotal =
    isTrade && isNum(t.contracts)
      ? roundHalfAway(isNum(t.fees) ? t.fees : inst.feePerContract * t.contracts, 4)
      : null;

  let grossPnl: number | null = null;
  let netPnl: number | null = null;
  if (isTrade && ticks !== null && isNum(t.contracts) && feesTotal !== null) {
    grossPnl = roundHalfAway(ticks * inst.tickValue * t.contracts, 4);
    netPnl = roundHalfAway(grossPnl - feesTotal, 4);
  }

  const noStop = !isNum(t.stopPrice);
  let riskUsd: number | null = null;
  let rMultiple: number | null = null;
  if (!noStop && isTrade && isNum(t.contracts)) {
    const riskTicks = Math.abs(t.entryPrice - (t.stopPrice as number)) / inst.tickSize;
    riskUsd = roundHalfAway(riskTicks * inst.tickValue * t.contracts, 4);
    if (riskUsd > 0 && netPnl !== null) rMultiple = roundHalfAway(netPnl / riskUsd, 4);
  }

  const entry = new Date(t.entryAt);
  const durationSec =
    t.exitAt && !t.timeEstimated
      ? Math.floor((new Date(t.exitAt).getTime() - entry.getTime()) / 1000)
      : null;

  return {
    ticks,
    feesTotal,
    grossPnl,
    netPnl,
    riskUsd,
    rMultiple,
    noStop,
    durationSec,
    weekday: isoWeekday(entry, inst.exchangeTz),
    timeBucket: t.timeEstimated ? null : timeBucket(entry, inst.exchangeTz),
    session: t.timeEstimated ? null : sessionFor(entry, settings),
  };
}
