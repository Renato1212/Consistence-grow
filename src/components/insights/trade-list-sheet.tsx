"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { fmtMoney, fmtR, fmtTicks, pnlClass } from "@/lib/format";
import { computeMetrics } from "@/lib/insights/metrics";
import type { InsightTrade } from "@/lib/insights/types";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { fmtPct, N } from "./bits";

/** The trades behind a number; each opens in the Journal detail. */
export function TradeListSheet({
  drill,
  byId,
  onClose,
}: {
  drill: { title: string; ids: string[] } | null;
  byId: Map<string, InsightTrade>;
  onClose: () => void;
}) {
  const trades = (drill?.ids ?? [])
    .map((id) => byId.get(id))
    .filter((t): t is InsightTrade => !!t)
    .sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  const m = computeMetrics(trades, { withCI: false });
  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="drill-sheet">
        <div className="border-b p-5 pr-12">
          <SheetTitle>{drill?.title}</SheetTitle>
          <SheetDescription className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              n <N n={m.n} />
            </span>
            <span className="num">win {fmtPct(m.winRate)}</span>
            <span className="num">
              exp <span className={pnlClass(m.expectancy)}>{fmtR(m.expectancy)}</span>
            </span>
            <span className={cn("num", pnlClass(m.netR))}>{m.rN ? fmtR(m.netR) : ""}</span>
          </SheetDescription>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto" data-testid="drill-list">
          {trades.map((t) => (
            <li key={t.id}>
              <Link
                href={`/journal?trade=${t.id}`}
                className="hover:bg-accent focus-visible:bg-accent flex items-center gap-3 px-5 py-2.5 text-sm outline-none"
              >
                {t.direction === "long" ? (
                  <ArrowUpRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-label="Long"
                  />
                ) : (
                  <ArrowDownRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-label="Short"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.symbol}</span>
                    {t.kind !== "taken" && (
                      <Badge variant="outline">{t.kind === "missed" ? "Missed" : "Observed"}</Badge>
                    )}
                    {t.playbook_name && (
                      <span className="text-muted-foreground truncate text-xs">
                        {t.playbook_name}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground num text-xs">
                    {formatInTz(t.entry_at, DISPLAY_TZ, "EEE dd MMM yyyy HH:mm")}
                  </div>
                </div>
                <div className="num text-right">
                  {t.kind === "observed" ? (
                    <span>{fmtTicks(t.ticks)}</span>
                  ) : (
                    <>
                      <div className={cn("font-semibold", pnlClass(t.r_multiple))}>
                        {t.r_multiple === null ? "no R" : fmtR(t.r_multiple)}
                      </div>
                      <div className={cn("text-xs", pnlClass(t.net_pnl))}>
                        {fmtMoney(t.net_pnl, t.currency)}
                      </div>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
