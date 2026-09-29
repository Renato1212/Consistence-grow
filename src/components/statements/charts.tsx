"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { fmtMoney } from "@/lib/format";
import { intensity, monthGrid } from "@/lib/journal/heatmap";
import type { CurvePoint, ScatterPoint } from "@/lib/statements/analysis";
import { cn } from "@/lib/utils";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const GRID = "var(--border)";

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-popover rounded-md border px-2.5 py-1.5 text-xs shadow-md">{children}</div>
  );
}

const money0 = (v: number) =>
  `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Cumulative broker P/L by day, or the account's net liquid value. */
export function AccountCurve({
  points,
  ids,
}: {
  points: CurvePoint[];
  ids: Record<string, string>;
}) {
  const router = useRouter();
  const [series, setSeries] = useState<"cum" | "nlv">("cum");
  const hasNlv = points.some((p) => p.nlv !== null);
  const data = series === "cum" ? [{ date: "", cum: 0, nlv: null, net: 0 }, ...points] : points;
  return (
    <figure data-testid="statements-curve">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-muted-foreground text-xs">
          {series === "cum"
            ? `Cumulative net P/L by statement day (n=${points.length})`
            : `Net liquid value at each close (n=${points.length})`}
        </figcaption>
        {hasNlv && (
          <Segmented
            size="sm"
            label="Curve"
            value={series}
            onChange={setSeries}
            options={[
              { value: "cum", label: "Cumulative P/L" },
              { value: "nlv", label: "Net liquid value" },
            ]}
          />
        )}
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            onClick={(s) => {
              const i = Number((s as { activeTooltipIndex?: unknown })?.activeTooltipIndex);
              const d = Number.isFinite(i) ? data[i] : undefined;
              if (d?.date && ids[d.date]) router.push(`/statements/${ids[d.date]}`);
            }}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" hide />
            <YAxis
              tick={AXIS}
              width={64}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
              tickFormatter={money0}
            />
            {series === "cum" && (
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            )}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as CurvePoint | undefined) : undefined;
                if (!p || !p.date) return null;
                return (
                  <TooltipBox>
                    <div className="num text-sm font-semibold">
                      {series === "cum" ? fmtMoney(p.cum) : fmtMoney(p.nlv)}
                    </div>
                    <div className="text-muted-foreground">
                      {p.date} · day {fmtMoney(p.net)}
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Line
              type="linear"
              dataKey={series}
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: "var(--primary)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Contracts traded vs P/L, one dot per product and day (green/red = P/L sign). */
export function VolumeScatter({ points }: { points: ScatterPoint[] }) {
  return (
    <figure data-testid="statements-scatter">
      <figcaption className="text-muted-foreground mb-2 text-xs">
        Contracts traded (x) vs realized P/L (y), one dot per product and day (n={points.length})
      </figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number"
              dataKey="contracts"
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              name="Contracts"
            />
            <YAxis
              type="number"
              dataKey="pnl"
              tick={AXIS}
              width={64}
              axisLine={false}
              tickLine={false}
              tickFormatter={money0}
            />
            <ZAxis range={[36, 36]} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            <Tooltip
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ScatterPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <TooltipBox>
                    <div className="font-medium">
                      {p.key} · {p.date}
                    </div>
                    <div className="num">
                      {p.contracts} contracts · {fmtMoney(p.pnl)}
                    </div>
                  </TooltipBox>
                );
              }}
            />
            {/* One series per sign (no per-point cells): stays fast with 1,000+ dots. */}
            {(
              [
                [points.filter((p) => p.pnl > 0), "var(--profit)"],
                [points.filter((p) => p.pnl < 0), "var(--loss)"],
                [points.filter((p) => p.pnl === 0), "var(--muted-foreground)"],
              ] as const
            ).map(([data, fill]) =>
              data.length ? (
                <Scatter
                  key={fill}
                  data={data}
                  fill={fill}
                  fillOpacity={0.7}
                  isAnimationActive={false}
                />
              ) : null,
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month calendar of broker P/L per statement day. Click a day → its statement. */
export function StatementCalendar({
  days,
  initialMonth,
}: {
  days: { date: string; id: string; net: number; attention: boolean }[];
  initialMonth: string; // yyyy-MM
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = initialMonth.split("-").map(Number);
    return { y, m };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = monthGrid(cursor.y, cursor.m);
  const cells = weeks
    .flat()
    .filter((d): d is string => !!d)
    .map((d) => byDate.get(d))
    .filter((d) => !!d);
  const maxAbs = Math.max(0, ...cells.map((c) => Math.abs(c.net)));
  const total = cells.reduce((s, c) => s + c.net, 0);
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
    <div data-testid="statements-calendar">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <h3 className="heading-caps min-w-32 text-center text-xs">{label}</h3>
          <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <p className="num text-muted-foreground text-xs">
          {cells.length} days · {fmtMoney(total)}
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
          const c = byDate.get(date);
          const a = c ? intensity(c.net, maxAbs) : 0;
          const bg = !c
            ? undefined
            : c.net > 0
              ? `color-mix(in oklab, var(--profit) ${Math.round(15 + a * 45)}%, transparent)`
              : c.net < 0
                ? `color-mix(in oklab, var(--loss) ${Math.round(15 + a * 45)}%, transparent)`
                : undefined;
          return (
            <button
              key={date}
              type="button"
              disabled={!c}
              onClick={() => c && router.push(`/statements/${c.id}`)}
              title={c ? `${date}: ${fmtMoney(c.net)}` : date}
              className={cn(
                "relative flex h-10 flex-col items-center justify-center rounded border text-center leading-tight sm:h-12",
                !c && "text-muted-foreground/50 border-transparent",
                c && "hover:ring-ring/50 hover:ring-2",
              )}
              style={bg ? { background: bg } : undefined}
            >
              <span className="num">{Number(date.slice(8))}</span>
              {c && <span className="num hidden sm:block">{money0(c.net)}</span>}
              {c?.attention && (
                <span
                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-500"
                  aria-label="needs attention"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
