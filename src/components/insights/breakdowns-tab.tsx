"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { fmtR } from "@/lib/format";
import { breakdownBy, timeWeekdayHeatmap } from "@/lib/insights/analysis";
import {
  DIMENSION_BY_KEY,
  DIMENSIONS,
  WEEKDAYS,
  type DimensionKey,
} from "@/lib/insights/dimensions";
import type { InsightTrade } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { MetricsTable, Section, useDrill } from "./bits";
import { ExpectancyBars } from "./charts";

/** Diverging fill for expectancy: loss ← neutral → profit, opacity by magnitude (cap ±2R). */
function heatStyle(exp: number | null, rN: number): React.CSSProperties {
  if (exp === null || rN === 0) return {};
  const a = Math.min(1, Math.abs(exp) / 2) * (rN < 5 ? 0.35 : 0.85) + 0.08;
  return {
    backgroundColor: `color-mix(in oklab, ${exp >= 0 ? "var(--profit)" : "var(--loss)"} ${Math.round(a * 100)}%, transparent)`,
  };
}

export function BreakdownsTab({
  trades,
  dimension,
  onDimension,
}: {
  trades: InsightTrade[];
  dimension: DimensionKey;
  onDimension: (d: DimensionKey) => void;
}) {
  const drill = useDrill();
  const dim = DIMENSION_BY_KEY[dimension];
  const rows = breakdownBy(trades, dimension);
  const heat = timeWeekdayHeatmap(trades);

  return (
    <div className="space-y-4">
      <Section
        title="Breakdown"
        aside={
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">By</span>
            <NativeSelect
              aria-label="Breakdown dimension"
              className="h-8 w-52 text-sm"
              value={dimension}
              onChange={(e) => onDimension(e.target.value as DimensionKey)}
            >
              {DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        }
        description={
          dimension === "tag" || dimension === "secondary"
            ? "A trade with several values counts in each of them."
            : undefined
        }
      >
        <ExpectancyBars
          rows={rows}
          dimension={dim.label}
          onPick={(r) => drill(`${dim.label}: ${r.label}`, r.ids)}
        />
        <MetricsTable rows={rows} dimension={dim.label} testId="breakdown-table" />
      </Section>

      <Section
        title="Time of day × weekday"
        description="Expectancy (R per trade) by 30-minute bucket in the exchange time zone; n in each cell. Faint cells have fewer than 5 trades with R."
      >
        {heat.buckets.length === 0 ? (
          <p className="text-muted-foreground text-sm">No trades.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table
              className="num w-full min-w-[420px] border-separate border-spacing-0.5 text-xs"
              data-testid="time-heatmap"
            >
              <thead>
                <tr>
                  <th className="text-muted-foreground w-14 text-left font-normal">Time</th>
                  {heat.weekdays.map((d) => (
                    <th key={d} className="text-muted-foreground font-normal">
                      {WEEKDAYS[d - 1]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.buckets.map((b) => (
                  <tr key={b}>
                    <th className="text-muted-foreground text-left font-normal">{b}</th>
                    {heat.weekdays.map((d) => {
                      const c = heat.cells.get(`${d}|${b}`);
                      if (!c) return <td key={d} className="bg-muted/30 h-9 rounded-sm" />;
                      return (
                        <td key={d} className="h-9 p-0">
                          <button
                            type="button"
                            onClick={() => drill(`${WEEKDAYS[d - 1]} ${b}`, c.ids)}
                            style={heatStyle(c.exp, c.rN)}
                            className={cn(
                              "hover:ring-foreground/40 focus-visible:ring-ring flex h-9 w-full flex-col items-center justify-center rounded-sm border outline-none hover:ring-1 focus-visible:ring-2",
                            )}
                            aria-label={`${WEEKDAYS[d - 1]} ${b}: n ${c.n}, expectancy ${fmtR(c.exp)}`}
                            title={`${WEEKDAYS[d - 1]} ${b} · n=${c.n} · ${fmtR(c.exp)}`}
                          >
                            <span className="font-semibold">
                              {c.exp === null ? "—" : fmtR(c.exp)}
                            </span>
                            <span className="text-muted-foreground text-[10px]">n={c.n}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
