"use client";

import { createContext, useContext } from "react";
import { List } from "lucide-react";

import { SampleBadge, weakClass } from "@/components/review/stat-bits";
import { fmtR, pnlClass } from "@/lib/format";
import type { Row } from "@/lib/insights/analysis";
import type { Interval } from "@/lib/insights/metrics";
import { cn } from "@/lib/utils";

/** Opens the side sheet listing the trades behind a number. */
export type Drill = (title: string, ids: string[]) => void;
export const DrillContext = createContext<Drill>(() => {});
export const useDrill = () => useContext(DrillContext);

export function fmtPct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

export function fmtPctCI(ci: Interval | null): string {
  return ci ? `${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%` : "";
}

export function fmtRCI(ci: Interval | null): string {
  return ci ? `${fmtR(ci.lo)} … ${fmtR(ci.hi)}` : "";
}

export function Section({
  title,
  children,
  aside,
  className,
  description,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  description?: string;
}) {
  return (
    <section
      className={cn("bg-card space-y-3 rounded-xl border p-4", className)}
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="heading-caps text-xs">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** n with the honest-stats treatment. */
export function N({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("num", weakClass(n))}>{n}</span>
      <SampleBadge n={n} />
    </span>
  );
}

export function DrillButton({
  title,
  ids,
  label,
}: {
  title: string;
  ids: string[];
  label?: string;
}) {
  const drill = useDrill();
  return (
    <button
      type="button"
      onClick={() => drill(title, ids)}
      disabled={ids.length === 0}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-30"
      aria-label={label ?? `Show ${ids.length} trades: ${title}`}
    >
      <List className="size-4" aria-hidden />
    </button>
  );
}

/**
 * Metric table: n (greyed < 10, badge < 20), win rate with Wilson CI,
 * expectancy with bootstrap CI (n with R shown), net R, click-through.
 */
export function MetricsTable({
  rows,
  dimension,
  testId,
}: {
  rows: Row[];
  dimension: string;
  testId?: string;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No trades.</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-sm" data-testid={testId}>
        <thead className="text-muted-foreground text-xs">
          <tr className="border-b">
            <th className="py-2 pr-2 text-left font-normal">{dimension}</th>
            <th className="px-2 text-right font-normal">n</th>
            <th className="px-2 text-right font-normal">Win rate (95% CI)</th>
            <th className="px-2 text-right font-normal">Expectancy (95% CI)</th>
            <th className="px-2 text-right font-normal">Net R</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={cn("border-b last:border-0", weakClass(r.m.n))}
              data-testid="metrics-row"
            >
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="px-2 text-right">
                <N n={r.m.n} />
              </td>
              <td className="num px-2 text-right whitespace-nowrap">
                {fmtPct(r.m.winRate)}{" "}
                <span className="text-muted-foreground text-xs">{fmtPctCI(r.m.winCI)}</span>
              </td>
              <td className="num px-2 text-right whitespace-nowrap">
                <span className={pnlClass(r.m.expectancy)}>{fmtR(r.m.expectancy)}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {fmtRCI(r.m.expCI)}
                  {r.m.rN !== r.m.n && ` · R n=${r.m.rN}`}
                </span>
              </td>
              <td className={cn("num px-2 text-right", pnlClass(r.m.netR))}>
                {r.m.rN ? fmtR(r.m.netR) : "—"}
              </td>
              <td className="text-right">
                <DrillButton title={`${dimension}: ${r.label}`} ids={r.ids} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HypothesisNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-muted-foreground border-primary/40 rounded-md border border-dashed px-3 py-2 text-xs">
      <span className="text-primary font-semibold">Hypothesis to test</span> — not a confirmed edge.{" "}
      {children}
    </p>
  );
}
