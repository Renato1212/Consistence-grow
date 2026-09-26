"use client";

import { useState } from "react";

import { PnlHeatmap } from "@/components/journal/pnl-heatmap";
import { Segmented } from "@/components/ui/segmented";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import { computeMetrics, equitySeries, rHistogram } from "@/lib/insights/metrics";
import type { InsightTrade } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPctCI, fmtRCI, N, Section, useDrill } from "./bits";
import { EquityChart, RHistogram } from "./charts";

function Tile({
  label,
  children,
  sub,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-3" data-testid={testId}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold">{children}</div>
      {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

export function OverviewTab({ trades }: { trades: InsightTrade[] }) {
  const drill = useDrill();
  const m = computeMetrics(trades);
  const currencies = Object.keys(m.byCurrency).sort();
  const [unit, setUnit] = useState<string>("R");
  const activeUnit = unit === "R" || currencies.includes(unit) ? unit : "R";
  const byId = new Map(trades.map((t) => [t.id, t]));
  const noR = m.n - m.rN;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="kpis">
        <Tile label="Trades" testId="kpi-n">
          <N n={m.n} />
        </Tile>
        <Tile
          label="Net R"
          sub={noR > 0 ? `${noR} without a stop (no R)` : `over ${m.rN} trades with R`}
          testId="kpi-net-r"
        >
          <span className={cn("num", pnlClass(m.netR))}>{m.rN ? fmtR(m.netR) : "—"}</span>
        </Tile>
        <Tile label="Net P&L" testId="kpi-net-money">
          {currencies.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="flex flex-col">
              {currencies.map((c) => (
                <span key={c} className={cn("num", pnlClass(m.byCurrency[c]))}>
                  {fmtMoney(m.byCurrency[c], c)}
                </span>
              ))}
            </span>
          )}
        </Tile>
        <Tile
          label="Win rate"
          sub={m.winCI ? `95% CI ${fmtPctCI(m.winCI)}` : undefined}
          testId="kpi-win"
        >
          <span className="num">{fmtPct(m.winRate)}</span>
        </Tile>
        <Tile
          label="Expectancy"
          sub={m.expCI ? `95% CI ${fmtRCI(m.expCI)}` : `R n=${m.rN}`}
          testId="kpi-expectancy"
        >
          <span className={cn("num", pnlClass(m.expectancy))}>{fmtR(m.expectancy)}</span>
        </Tile>
        <Tile label="Avg win / avg loss">
          <span className="num">
            <span className={pnlClass(m.avgWinR)}>{fmtR(m.avgWinR)}</span>
            <span className="text-muted-foreground"> / </span>
            <span className={pnlClass(m.avgLossR)}>{fmtR(m.avgLossR)}</span>
          </span>
        </Tile>
        <Tile label="Profit factor" sub="gross win R ÷ gross loss R">
          <span className="num">{m.profitFactor ?? "—"}</span>
        </Tile>
        <Tile
          label="Max drawdown"
          sub={currencies.map((c) => fmtMoney(m.maxDrawdown[c], c)).join(" · ") || undefined}
        >
          <span className={cn("num", pnlClass(m.maxDrawdownR))}>
            {m.rN ? fmtR(m.maxDrawdownR) : "—"}
          </span>
        </Tile>
        <Tile label="Longest streaks" sub="wins / losses in a row">
          <span className="num">
            <span className="text-profit">{m.longestWin}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-loss">{m.longestLoss}</span>
          </span>
        </Tile>
      </div>

      <Section
        title="Equity curve"
        aside={
          currencies.length > 0 && (
            <Segmented
              label="Unit"
              size="sm"
              value={activeUnit}
              onChange={setUnit}
              options={["R", ...currencies].map((u) => ({ value: u, label: u }))}
            />
          )
        }
      >
        {(() => {
          const points = equitySeries(trades, activeUnit);
          if (!points.length)
            return (
              <p className="text-muted-foreground text-sm">
                {activeUnit === "R" ? "No trades with a stop (R) in this set." : "No trades."}
              </p>
            );
          return (
            <EquityChart
              points={points}
              unit={activeUnit}
              onPick={(id) => {
                const t = byId.get(id);
                if (t) drill(`${t.symbol} trade`, [id]);
              }}
            />
          );
        })()}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="R-multiple distribution">
          {m.rN ? (
            <RHistogram
              bins={rHistogram(trades)}
              onPick={(label, ids) => drill(`R ${label}`, ids)}
            />
          ) : (
            <p className="text-muted-foreground text-sm">No trades with a stop (R) in this set.</p>
          )}
        </Section>
        <PnlHeatmap
          trades={trades}
          key={trades.at(-1)?.trade_date?.slice(0, 7) ?? "now"}
          initialMonth={trades.at(-1)?.trade_date?.slice(0, 7)}
          onPickDay={(date) =>
            drill(
              `Trades on ${date}`,
              trades.filter((t) => t.trade_date === date).map((t) => t.id),
            )
          }
        />
      </div>
    </div>
  );
}
