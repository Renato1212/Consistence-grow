import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { WeeklyAi } from "@/components/ai/weekly-ai";
import { ActionItemsList } from "@/components/review/action-items-list";
import { EquityCurve } from "@/components/review/equity-curve";
import { SetupScorecard } from "@/components/review/setup-scorecard";
import { SampleBadge, weakClass } from "@/components/review/stat-bits";
import { WeekReflectionClient } from "@/components/review/week-reflection-client";
import { BrokerCard } from "@/components/statements/broker-card";
import { PageHeader } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, parseIsoWeekKey } from "@/lib/calendar/dates";
import { hasAiToken, loadAiInsights, loadAiRequests, loadPlaybookOptions } from "@/lib/data/ai";
import { loadSetupScorecard } from "@/lib/data/routine";
import { loadWeek } from "@/lib/data/week";
import { domainMeta, type DomainCode } from "@/lib/domains";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import {
  breakdown,
  equityCurve,
  extremes,
  summarize,
  type BreakdownRow,
  type FactTrade,
} from "@/lib/review/stats";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/review/week/[week]">): Promise<Metadata> {
  const { week } = await params;
  return { title: `Week ${week}` };
}

const fmtDay = (d: string, p = "EEE d MMM") => formatInTz(`${d}T12:00:00Z`, "UTC", p);

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("bg-card space-y-3 rounded-xl border p-4", className)}
      aria-label={title}
    >
      <h2 className="heading-caps text-xs">{title}</h2>
      {children}
    </section>
  );
}

function BreakdownTable({
  rows,
  label,
}: {
  rows: BreakdownRow[];
  label: (k: string) => React.ReactNode;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No trades.</p>;
  return (
    <table className="num w-full text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="text-left font-normal" />
          <th className="text-right font-normal">n</th>
          <th className="text-right font-normal">Net R</th>
          <th className="text-right font-normal">Win %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={weakClass(r.n)}>
            <td className="py-1 font-sans">{label(r.key)}</td>
            <td className="text-right">{r.n}</td>
            <td className={cn("text-right", pnlClass(r.netR))}>{r.rN ? fmtR(r.netR) : "—"}</td>
            <td className="text-right">
              {r.winRate === null ? "—" : `${Math.round(r.winRate * 100)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradeList({ trades, empty }: { trades: FactTrade[]; empty: string }) {
  if (trades.length === 0) return <p className="text-muted-foreground text-xs">{empty}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {trades.map((t) => (
        <li key={t.id}>
          <Link
            href={`/journal?trade=${t.id}`}
            className="hover:bg-muted/50 flex items-center gap-2 rounded px-1"
          >
            <span className="text-muted-foreground num w-20 text-xs">
              {formatInTz(t.entry_at, DISPLAY_TZ, "EEE HH:mm")}
            </span>
            <span className="flex-1">
              {t.symbol} {t.direction}
            </span>
            {t.grade_process && (
              <Badge variant="outline" className="text-[10px]">
                {t.grade_process}
              </Badge>
            )}
            <span className={cn("num w-14 text-right", pnlClass(t.r_multiple))}>
              {fmtR(t.r_multiple)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function WeekPage({ params }: PageProps<"/review/week/[week]">) {
  const { week: key } = await params;
  const parsed = parseIsoWeekKey(key);
  if (!parsed) notFound();
  const [w, aiInsights, aiRequests, playbooks, hasToken] = await Promise.all([
    loadWeek(parsed.year, parsed.week),
    loadAiInsights({ week: key, scope: "weekly", limit: 1 }),
    loadAiRequests(),
    loadPlaybookOptions(),
    hasAiToken(),
  ]);
  const scorecard = await loadSetupScorecard(w.year, w.week, w.start, w.end);
  const s = summarize(w.trades);
  const curve = equityCurve(w.trades);
  const byId = new Map(w.trades.map((t) => [t.id, t]));
  const ext = extremes(w.trades);
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.start, i));
  const maxViolations = Math.max(1, ...Object.values(w.violationsByDay));

  return (
    <>
      <PageHeader title={`Week ${w.key.slice(6)} · ${w.year}`}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/review/week/${w.prevKey}`} aria-label="Previous week">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <span className="text-muted-foreground text-sm">
            {fmtDay(w.start, "d MMM")} – {fmtDay(w.end, "d MMM")}
          </span>
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/review/week/${w.nextKey}`} aria-label="Next week">
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="empty:hidden md:col-span-2">
          <BrokerCard from={w.start} to={w.end} title="Broker statements this week" />
        </div>
        <Card title="Summary" className="md:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="week-summary">
            <div>
              <div className="text-muted-foreground heading-caps text-[10px]">Trades</div>
              <div className="num text-lg font-semibold">
                {s.n} <SampleBadge n={s.n} />
              </div>
            </div>
            <div className={weakClass(s.n)}>
              <div className="text-muted-foreground heading-caps text-[10px]">Win rate</div>
              <div className="num text-lg font-semibold">
                {s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground heading-caps text-[10px]">Net R (n={s.rN})</div>
              <div className={cn("num text-lg font-semibold", pnlClass(s.netR))}>
                {s.rN ? fmtR(s.netR) : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground heading-caps text-[10px]">Net</div>
              <div className="num text-sm font-semibold">
                {Object.keys(s.byCurrency).length === 0
                  ? "—"
                  : Object.entries(s.byCurrency).map(([cur, v]) => (
                      <div key={cur} className={pnlClass(v)}>
                        {fmtMoney(v, cur)}
                      </div>
                    ))}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground heading-caps text-[10px]">Debriefs</div>
              <div className="num text-lg font-semibold">
                {Object.values(w.debriefs).filter((d) => d === "complete").length}/
                {new Set(w.trades.filter((t) => t.kind === "taken").map((t) => t.trade_date)).size}
              </div>
            </div>
          </div>
          <EquityCurve
            points={curve.map((p) => {
              const t = byId.get(p.id)!;
              return { ...p, label: `${t.symbol} ${t.direction}` };
            })}
          />
        </Card>

        <div className="empty:hidden md:col-span-2">
          <SetupScorecard year={w.year} week={w.week} rows={scorecard} />
        </div>

        <Card title="By domain">
          <BreakdownTable
            rows={breakdown(w.trades, (t) => t.primary_domain, "No domain")}
            label={(k) =>
              k === "No domain" ? (
                <span className="text-muted-foreground">No domain</span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn("size-2 rounded-full", domainMeta(k as DomainCode).bgClassName)}
                    aria-hidden
                  />
                  {domainMeta(k as DomainCode).short}
                </span>
              )
            }
          />
        </Card>

        <Card title="By playbook">
          <BreakdownTable
            rows={breakdown(w.trades, (t) => t.playbook_name, "No playbook")}
            label={(k) => k}
          />
        </Card>

        <Card title="Best & worst by R">
          <h3 className="text-muted-foreground text-[11px]">Top 3</h3>
          <TradeList trades={ext.topR} empty="No trades with R." />
          <h3 className="text-muted-foreground text-[11px]">Bottom 3</h3>
          <TradeList trades={ext.bottomR} empty="Not enough trades for a separate bottom 3." />
        </Card>

        <Card title="Best & worst by process grade">
          <h3 className="text-muted-foreground text-[11px]">Top 3</h3>
          <TradeList trades={ext.topProcess} empty="No process grades yet." />
          <h3 className="text-muted-foreground text-[11px]">Bottom 3</h3>
          <TradeList
            trades={ext.bottomProcess}
            empty="Not enough graded trades for a separate bottom 3."
          />
        </Card>

        <Card title="Rules broken per day">
          <ul className="space-y-1.5" data-testid="violations">
            {days.map((d) => {
              const n = w.violationsByDay[d] ?? 0;
              return (
                <li key={d} className="flex items-center gap-2 text-sm">
                  <Link href={`/review/${d}`} className="w-20 hover:underline">
                    {fmtDay(d, "EEE d")}
                  </Link>
                  <span className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full">
                    <span
                      className="bg-foreground/60 absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(n / maxViolations) * 100}%` }}
                    />
                  </span>
                  <span className="num w-6 text-right">{n}</span>
                  <span className="text-muted-foreground w-20 text-right text-xs">
                    {w.debriefs[d] === "complete"
                      ? "debriefed"
                      : w.debriefs[d] === "draft"
                        ? "draft"
                        : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-3">
          <ActionItemsList items={w.openActions} />
          {w.closedThisWeek.length > 0 && (
            <Card title="Closed this week">
              <ul className="text-muted-foreground space-y-1 text-sm">
                {w.closedThisWeek.map((a) => (
                  <li key={a.id}>
                    <span className="line-through">{a.text}</span>{" "}
                    <span className="text-xs">({a.status})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {w.openActions.length === 0 && w.closedThisWeek.length === 0 && (
            <Card title="Action items">
              <p className="text-muted-foreground text-sm">No action items.</p>
            </Card>
          )}
        </div>

        <div className="md:col-span-2">
          <WeekReflectionClient
            year={w.year}
            week={w.week}
            initial={{ reflection: w.review.reflection, goals: w.review.goals }}
            updatedAt={w.review.updatedAt}
          />
        </div>

        <div className="md:col-span-2">
          <WeeklyAi
            week={w.key}
            insight={aiInsights[0] ?? null}
            request={
              aiRequests.find(
                (r) => r.kind === "weekly" && r.week === w.key && r.status !== "done",
              ) ?? null
            }
            playbooks={playbooks}
            hasToken={hasToken}
          />
        </div>
      </div>
    </>
  );
}
