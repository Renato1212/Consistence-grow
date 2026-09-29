"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fmtMoney, fmtR } from "@/lib/format";
import { aggregateDaily, intensity, monthGrid, type HeatmapTrade } from "@/lib/journal/heatmap";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month calendar of daily results (taken trades). Green/red only for P&L; n per day shown. */
export function PnlHeatmap({
  trades,
  onPickDay,
  initialMonth,
}: {
  trades: HeatmapTrade[];
  onPickDay?: (date: string) => void;
  /** "yyyy-MM" to open on (default: the current Lisbon month). */
  initialMonth?: string;
}) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (initialMonth ?? formatInTz(new Date(), DISPLAY_TZ, "yyyy-MM"))
      .split("-")
      .map(Number);
    return { y, m };
  });
  const days = useMemo(() => aggregateDaily(trades), [trades]);
  const weeks = monthGrid(cursor.y, cursor.m);
  const monthCells = weeks
    .flat()
    .filter((d): d is string => !!d)
    .map((d) => days.get(d));
  const maxAbs = Math.max(0, ...monthCells.map((c) => Math.abs(c?.net.USD ?? 0)));
  const monthTotal = monthCells.reduce(
    (acc, c) => {
      if (!c) return acc;
      return { n: acc.n + c.n, r: acc.r + c.netR, usd: acc.usd + (c.net.USD ?? 0) };
    },
    { n: 0, r: 0, usd: 0 },
  );
  const label = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const shift = (delta: number) =>
    setCursor(({ y, m }) => {
      const idx = y * 12 + (m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  return (
    <section
      aria-label="Daily P&L calendar"
      className="bg-card rounded-lg border p-3"
      data-testid="pnl-heatmap"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <h2 className="heading-caps min-w-32 text-center text-xs">{label}</h2>
          <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <p className="num text-muted-foreground text-xs">
          n={monthTotal.n} · {fmtR(monthTotal.r)} · {fmtMoney(monthTotal.usd)}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-muted-foreground heading-caps pb-1 text-center text-[9px]">
            {d}
          </div>
        ))}
        {weeks.flat().map((date, i) => {
          if (!date) return <div key={`x${i}`} />;
          const c = days.get(date);
          const usd = c?.net.USD ?? 0;
          const a = intensity(usd, maxAbs);
          const bg = !c
            ? undefined
            : usd > 0
              ? `color-mix(in oklab, var(--profit) ${Math.round(15 + a * 35)}%, transparent)`
              : usd < 0
                ? `color-mix(in oklab, var(--loss) ${Math.round(15 + a * 35)}%, transparent)`
                : undefined;
          return (
            <button
              key={date}
              type="button"
              disabled={!c}
              onClick={() => c && onPickDay?.(date)}
              title={c ? `${date}: n=${c.n}, ${fmtR(c.netR)}, ${fmtMoney(usd)}` : date}
              className={cn(
                "flex h-10 flex-col items-center justify-center rounded border text-center leading-tight sm:h-12",
                !c && "text-muted-foreground/50 border-transparent",
                c && "hover:ring-ring/50 hover:ring-2",
              )}
              style={bg ? { background: bg } : undefined}
            >
              <span className="num">{Number(date.slice(8))}</span>
              {c && <span className="num hidden sm:block">{c.rN ? fmtR(c.netR) : `n=${c.n}`}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
