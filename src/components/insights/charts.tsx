"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtMoney, fmtR } from "@/lib/format";
import type { Row } from "@/lib/insights/analysis";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { fmtRCI } from "./bits";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const GRID = "var(--border)";

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-popover rounded-md border px-2.5 py-1.5 text-xs shadow-md">{children}</div>
  );
}

const indexOf = (state: unknown): number | null => {
  const i = (state as { activeTooltipIndex?: unknown } | null)?.activeTooltipIndex;
  const n = Number(i);
  return i === undefined || i === null || !Number.isFinite(n) ? null : n;
};

export type EquityPoint = { id: string; at: string; v: number; cum: number; label: string };

/** Cumulative result by trade (single series; the caption names it). Click a point → the trade. */
export function EquityChart({
  points,
  unit,
  onPick,
}: {
  points: EquityPoint[];
  unit: string; // "R" or a currency
  onPick: (id: string) => void;
}) {
  const fmt = (v: number) => (unit === "R" ? fmtR(v) : fmtMoney(v, unit));
  const data = [{ id: "", at: "", v: 0, cum: 0, label: "Start" }, ...points];
  return (
    <figure data-testid="insights-equity">
      <figcaption className="text-muted-foreground mb-2 text-xs">
        Cumulative {unit === "R" ? "R" : `net ${unit}`} by trade (n={points.length})
      </figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            onClick={(s) => {
              const i = indexOf(s);
              if (i !== null && i > 0 && data[i]) onPick(data[i].id);
            }}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="at" hide />
            <YAxis
              tick={AXIS}
              width={64}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => fmt(v)}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as EquityPoint | undefined) : undefined;
                if (!p || !p.id) return null;
                return (
                  <TooltipBox>
                    <div className="num text-sm font-semibold">{fmt(p.cum)}</div>
                    <div className="text-muted-foreground">
                      {p.label} · {fmt(p.v)} · {formatInTz(p.at, DISPLAY_TZ, "dd MMM HH:mm")}
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Line
              type="linear"
              dataKey="cum"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: "var(--primary)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** R-multiple histogram; bins are P&L so green/red by sign. Click a bar → its trades. */
export function RHistogram({
  bins,
  onPick,
}: {
  bins: { label: string; ids: string[] }[];
  onPick: (label: string, ids: string[]) => void;
}) {
  const data = bins.map((b) => ({ ...b, n: b.ids.length }));
  const total = data.reduce((a, b) => a + b.n, 0);
  return (
    <figure data-testid="insights-histogram">
      <figcaption className="text-muted-foreground mb-2 text-xs">
        Trades per R bucket (n={total})
      </figcaption>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={(s) => {
              const i = indexOf(s);
              if (i !== null && data[i]?.n) onPick(data[i].label, data[i].ids);
            }}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval={0}
            />
            <YAxis tick={AXIS} width={32} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = active
                  ? (payload?.[0]?.payload as (typeof data)[number] | undefined)
                  : undefined;
                if (!p) return null;
                return (
                  <TooltipBox>
                    <span className="font-medium">{p.label}</span> ·{" "}
                    <span className="num">{p.n}</span> trade{p.n === 1 ? "" : "s"}
                  </TooltipBox>
                );
              }}
            />
            <Bar dataKey="n" maxBarSize={32} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell
                  key={d.label}
                  fill={i < 3 ? "var(--loss)" : "var(--profit)"}
                  className="cursor-pointer"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Expectancy per value with its bootstrap 95% interval. Click a bar → its trades. */
export function ExpectancyBars({
  rows,
  dimension,
  onPick,
}: {
  rows: Row[];
  dimension: string;
  onPick: (row: Row) => void;
}) {
  const data = rows
    .filter((r) => r.m.expectancy !== null)
    .map((r) => ({
      key: r.key,
      label: r.label,
      exp: r.m.expectancy as number,
      err: r.m.expCI ? [r.m.expectancy! - r.m.expCI.lo, r.m.expCI.hi - r.m.expectancy!] : [0, 0],
      row: r,
    }));
  if (!data.length)
    return <p className="text-muted-foreground text-sm">No trades with R (a stop) in this set.</p>;
  const height = Math.max(120, data.length * 32 + 32);
  return (
    <figure data-testid="insights-bars">
      <figcaption className="text-muted-foreground mb-2 text-xs">
        Expectancy (R per trade) by {dimension.toLowerCase()}, with 95% bootstrap interval
      </figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            onClick={(s) => {
              const i = indexOf(s);
              if (i !== null && data[i]) onPick(data[i].row);
            }}
          >
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis
              type="number"
              tick={AXIS}
              tickFormatter={(v: number) => fmtR(v)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS}
              width={120}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval={0}
            />
            <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = active
                  ? (payload?.[0]?.payload as (typeof data)[number] | undefined)
                  : undefined;
                if (!p) return null;
                return (
                  <TooltipBox>
                    <div className="font-medium">{p.label}</div>
                    <div className="num">
                      {fmtR(p.exp)}{" "}
                      <span className="text-muted-foreground">{fmtRCI(p.row.m.expCI)}</span>
                    </div>
                    <div className="text-muted-foreground num">
                      n={p.row.m.n} · R n={p.row.m.rN}
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Bar dataKey="exp" maxBarSize={20} radius={4} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.key}
                  fill={d.exp >= 0 ? "var(--profit)" : "var(--loss)"}
                  fillOpacity={d.row.m.rN < 10 ? 0.4 : 1}
                  className="cursor-pointer"
                />
              ))}
              <ErrorBar
                dataKey="err"
                width={4}
                strokeWidth={1.5}
                stroke="var(--foreground)"
                direction="x"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
