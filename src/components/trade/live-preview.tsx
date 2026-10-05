"use client";

import { AlertTriangle } from "lucide-react";

import { fmtDuration, fmtMoney, fmtR, fmtTicks, pnlClass } from "@/lib/format";
import { computeTrade } from "@/lib/trading/pnl";
import {
  localInputToIso,
  parseDecimal,
  parsePrice,
  type FormInstrument,
  type TradeFormValues,
} from "@/lib/trading/trade-form";
import { cn } from "@/lib/utils";

/** Instant P&L/R preview from the TS mirror of the DB maths. R first, then money. */
export function LivePreview({
  values,
  inst,
  timeEstimated = false,
}: {
  values: TradeFormValues;
  inst?: FormInstrument;
  /** Times not known yet (built from a broker statement). */
  timeEstimated?: boolean;
}) {
  if (!inst || !values.direction) {
    return <PreviewShell>Pick instrument and direction to see ticks, R and P&L.</PreviewShell>;
  }
  const contracts = parseDecimal(values.contracts);
  const n = typeof contracts === "number" ? contracts : null;
  const entry = parsePrice(values.entryPrice, inst, n).value;
  const exit = parsePrice(values.exitPrice, inst, n).value;
  const stop = parsePrice(values.stopPrice, inst).value;
  const entryAt = localInputToIso(values.entryAt);
  const exitAt = localInputToIso(values.exitAt);
  const fees = parseDecimal(values.fees);
  if (entry === null || !entryAt) {
    return <PreviewShell>Add the entry price to see the preview.</PreviewShell>;
  }

  const c = computeTrade(inst, {
    kind: values.kind,
    direction: values.direction,
    entryAt,
    exitAt: exitAt && exit !== null ? exitAt : null,
    entryPrice: entry,
    exitPrice: exit,
    stopPrice: stop,
    contracts: n,
    timeEstimated,
    fees: typeof fees === "number" ? fees : null,
  });

  const isObserved = values.kind === "observed";

  return (
    <section
      aria-label="Trade preview"
      data-testid="live-preview"
      className="bg-card grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border p-4 sm:grid-cols-6"
    >
      {!isObserved && (
        <Stat label="R" big>
          {c.noStop ? (
            <span className="text-muted-foreground text-sm">no stop → no R</span>
          ) : (
            <span className={pnlClass(c.rMultiple)}>{fmtR(c.rMultiple)}</span>
          )}
        </Stat>
      )}
      {!isObserved && (
        <Stat label={values.kind === "missed" ? "Left on table" : "Net"} big>
          <span className={pnlClass(c.netPnl)}>{fmtMoney(c.netPnl, inst.currency)}</span>
        </Stat>
      )}
      <Stat label={isObserved ? "Move" : "Ticks"}>{fmtTicks(c.ticks)}</Stat>
      {!isObserved && (
        <Stat label="Fees">
          {fmtMoney(c.feesTotal === null ? null : -c.feesTotal, inst.currency).replace("+", "")}
        </Stat>
      )}
      <Stat label="Session">{c.session ?? "—"}</Stat>
      <Stat label="Duration">{fmtDuration(c.durationSec)}</Stat>
      {!isObserved && inst.feePerContract === 0 && fees === null && (
        <p className="text-muted-foreground col-span-full flex items-center gap-1.5 text-xs">
          <AlertTriangle className="text-warn size-3.5" aria-hidden />
          No fees set for {inst.symbol} — net equals gross. Set fees in Settings → Instruments.
        </p>
      )}
    </section>
  );
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-testid="live-preview"
      className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm"
    >
      {children}
    </p>
  );
}

function Stat({
  label,
  children,
  big,
}: {
  label: string;
  children: React.ReactNode;
  big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground heading-caps text-[10px]">{label}</div>
      <div className={cn("num truncate", big ? "text-lg font-semibold" : "text-sm")}>
        {children}
      </div>
    </div>
  );
}
