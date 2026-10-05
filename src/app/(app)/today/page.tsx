import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardPen,
  Landmark,
  Moon,
  NotebookPen,
  Plus,
  Tags,
} from "lucide-react";

import { EventRowButton } from "@/components/calendar/calendar-view";
import { RoutineTimeline } from "@/components/routine/timeline";
import { PageHeader } from "@/components/shell/empty-state";
import { ActionItemsList } from "@/components/review/action-items-list";
import { AiNotes } from "@/components/today/ai-notes";
import { BriefCard } from "@/components/today/brief-card";
import { Countdown } from "@/components/today/countdown";
import { PlanView } from "@/components/today/plan-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sessionRequest } from "@/lib/ai/requests";
import { extractTldr } from "@/lib/briefs/tldr";
import { addDays, isWeekend } from "@/lib/calendar/dates";
import { HolidayCalendar } from "@/lib/calendar/holidays";
import { loadAiInsights, loadPlaybookOptions } from "@/lib/data/ai";
import { countNeedsReview } from "@/lib/data/import";
import { loadDayEvents } from "@/lib/data/prep";
import { loadGuardTrades, loadQuickPreps, loadRoutine, loadRoutineDay } from "@/lib/data/routine";
import { loadStatementNudge } from "@/lib/data/statements";
import { loadToday, type DayResult } from "@/lib/data/today";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import type { SessionCode } from "@/lib/prep/prep-form";
import { blocksForDay } from "@/lib/routine/schedule";
import { dateInTz, DISPLAY_TZ, formatInTz } from "@/lib/time";
import type { TodayPhase } from "@/lib/today/state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };

const PHASE_LABEL: Record<TodayPhase, string> = {
  closed: "Market closed",
  pre_eu: "Before EU session",
  eu: "EU session",
  us: "US session",
  post: "After the close",
};

function loadNow() {
  const now = new Date();
  return loadToday(now).then((d) => ({ ...d, now }));
}

/** The Pre-Open TL;DR as a one-line narrative to start the 60-second prep from. */
function narrativeFrom(markdown: string) {
  return extractTldr(markdown, 2).join(" · ").slice(0, 300);
}

/** Latest pre-session analysis of today's current session, if the routine ran today. */
async function loadSessionNotes(date: string, phase: TodayPhase) {
  if (phase === "closed" || phase === "post") return null;
  const session = phase === "us" ? "US" : "EU";
  const key = sessionRequest(session).filterKey;
  const [insights, playbooks] = await Promise.all([
    loadAiInsights({ scope: "session", limit: 6 }),
    loadPlaybookOptions(),
  ]);
  const insight = insights.find(
    (i) => i.filterKey === key && dateInTz(i.createdAt, DISPLAY_TZ) === date,
  );
  return insight ? { insight, playbooks } : null;
}

function DayPnl({ result }: { result: DayResult }) {
  if (result.n === 0) return <span className="text-muted-foreground text-xs">No trades today</span>;
  return (
    <span className="num inline-flex items-baseline gap-2 text-xs" data-testid="today-pnl">
      <span className={cn("font-semibold", pnlClass(result.netR))}>
        {result.rN > 0 ? fmtR(result.netR) : "— R"}
      </span>
      {Object.entries(result.byCurrency).map(([cur, v]) => (
        <span key={cur} className={pnlClass(v)}>
          {fmtMoney(v, cur)}
        </span>
      ))}
      <span className="text-muted-foreground">
        {result.n} trade{result.n === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  href,
  cta,
  done,
  compact,
}: {
  icon: typeof ClipboardPen;
  title: string;
  description: string;
  href: string;
  cta: string;
  done?: boolean;
  /** A quiet row in the housekeeping list. */
  compact?: boolean;
}) {
  if (compact)
    return (
      <li
        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
        data-testid="today-action"
      >
        <Icon className="text-muted-foreground hidden size-4 shrink-0 sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <Link href={href}>{cta}</Link>
        </Button>
      </li>
    );
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center",
        done ? "bg-card" : "border-primary/50 bg-primary/5",
      )}
      data-testid="today-action"
    >
      <Icon
        className={cn("size-8 shrink-0", done ? "text-muted-foreground" : "text-primary-ink")}
        aria-hidden
      />
      <div className="flex-1">
        <h2 className="heading-caps text-sm">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Button asChild variant={done ? "outline" : "default"}>
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

export default async function TodayPage() {
  const data = await loadNow();
  const { state, preps, result } = data;
  const [aiNotes, needsReview, statements, routine] = await Promise.all([
    loadSessionNotes(state.date, state.phase),
    countNeedsReview(),
    loadStatementNudge(state.date),
    loadRoutine(),
  ]);
  // Today's routine; on a closed day, the next trading day's (to prepare ahead).
  const cal = new HolidayCalendar(data.holidays);
  let routineDate = state.date;
  let blocks = blocksForDay(routine.routine, routineDate, cal);
  for (let i = 0; blocks.length === 0 && i < 7; i++) {
    routineDate = addDays(routineDate, 1);
    blocks = blocksForDay(routine.routine, routineDate, cal);
  }
  const upcoming = routineDate !== state.date;
  const [routineDay, guardTrades, quickPreps, routineEvents] = await Promise.all([
    loadRoutineDay(routineDate),
    loadGuardTrades(routineDate),
    loadQuickPreps(routineDate),
    upcoming ? loadDayEvents(routineDate, cal) : data.events,
  ]);
  const late = state.phase === "us" || state.phase === "post";
  const primaryBrief = late
    ? (data.briefs.US ?? data.briefs.EU)
    : (data.briefs.EU ?? data.briefs.US);
  const briefInTimeline = new Set(
    (upcoming ? [] : blocks)
      .filter((b) => b.steps.some((st) => st.kind === "brief"))
      .map((b) => b.session),
  );
  const briefNode = (s: SessionCode) => {
    const b = upcoming ? undefined : data.briefs[s];
    if (!b) return undefined;
    return <BriefCard brief={b} testId={b === primaryBrief ? "brief-card" : "brief-card-other"} />;
  };
  const hasDebriefBlock = blocks.some((b) => b.kind === "debrief");
  const prepHref = (s: SessionCode) => `/prep/${state.date}/${s.toLowerCase()}`;
  const eu = preps.EU;
  const us = preps.US;

  function prepCard(s: SessionCode) {
    const p = preps[s];
    if (!p)
      return (
        <ActionCard
          icon={ClipboardPen}
          title={`Start ${s} prep`}
          description={
            s === "US" && eu
              ? "Copy the EU prep forward and edit only what changed."
              : "Readiness, context, levels, scenarios, risk plan and rules."
          }
          href={prepHref(s)}
          cta={`Start ${s} prep`}
        />
      );
    if (!p.snapshot.completedAt)
      return (
        <ActionCard
          icon={ClipboardPen}
          title={`Continue ${s} prep`}
          description="Draft saved — finish it and mark it complete."
          href={prepHref(s)}
          cta={`Continue ${s} prep`}
        />
      );
    return (
      <ActionCard
        icon={CheckCircle2}
        title={`${s} prep complete`}
        description={`Completed ${formatInTz(p.snapshot.completedAt, "Europe/Lisbon", "HH:mm")}. Everything stays editable.`}
        href={prepHref(s)}
        cta={`Open ${s} prep`}
        done
      />
    );
  }

  const planPrep = state.phase === "us" ? (us ?? eu) : eu;
  const nextWeekday = (() => {
    let d = addDays(state.date, 1);
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  })();

  return (
    <>
      <PageHeader title="Today">
        <DayPnl result={result} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {formatInTz(`${state.date}T12:00:00Z`, "UTC", "EEEE d MMMM")}
        </span>
        <Badge data-testid="today-phase" data-phase={state.phase}>
          {PHASE_LABEL[state.phase]}
        </Badge>
        {state.usHoliday && <Badge variant="outline">US holiday: {state.usHoliday}</Badge>}
        {state.usEarlyClose && (
          <Badge variant="outline">US early close {state.usEarlyClose} ET</Badge>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href={`/calendar?view=day&date=${state.date}`}>
            <CalendarDays aria-hidden />
            Calendar
          </Link>
        </Button>
      </div>

      <div className="space-y-4">
        {data.goals.length > 0 && (
          <section className="bg-card rounded-xl border p-4" aria-label="This week's goals">
            <h2 className="heading-caps mb-2 text-xs">This week&apos;s goals</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="week-goals">
              {data.goals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ol>
          </section>
        )}

        {blocks.length > 0 && (
          <RoutineTimeline
            date={routineDate}
            upcoming={upcoming}
            nowIso={data.now.toISOString()}
            blocks={blocks}
            days={routineDay}
            trades={guardTrades}
            dayMaxLossUsd={routine.routine.dayMaxLossUsd}
            newsMinImportance={routine.routine.newsMinImportance}
            events={routineEvents.map((e) => ({
              id: e.id,
              title: e.title,
              startsAt: e.startsAt,
              importance: e.importance,
              instruments: e.instruments,
            }))}
            instruments={data.instruments
              .filter((i) => i.active)
              .map((i) => ({ id: i.id, symbol: i.symbol, name: i.name }))}
            quickPreps={quickPreps}
            briefs={{ EU: briefNode("EU"), US: briefNode("US") }}
            suggestions={{
              EU: !upcoming && data.briefs.EU ? narrativeFrom(data.briefs.EU.markdown) : undefined,
              US: !upcoming && data.briefs.US ? narrativeFrom(data.briefs.US.markdown) : undefined,
            }}
            setups={Object.fromEntries(data.playbooks.map((p) => [p.id, p.name]))}
            debriefDone={!upcoming && data.debrief === "complete"}
          />
        )}

        {primaryBrief && !briefInTimeline.has(primaryBrief.session) && (
          <BriefCard brief={primaryBrief} />
        )}

        {aiNotes && <AiNotes insight={aiNotes.insight} playbooks={aiNotes.playbooks} />}

        <ActionItemsList items={data.actionItems} />

        {(needsReview > 0 ||
          statements?.missingDate ||
          statements?.unsplit ||
          (statements?.open ?? 0) > 0 ||
          (data.missingDebrief && state.phase !== "post")) && (
          <section className="bg-card rounded-xl border" aria-label="Housekeeping">
            <h2 className="heading-caps border-b px-4 py-3 text-xs">Housekeeping</h2>
            <ul className="divide-y">
              {needsReview > 0 && (
                <ActionCard
                  icon={Tags}
                  title={`${needsReview} imported trade${needsReview === 1 ? "" : "s"} need${needsReview === 1 ? "s" : ""} tagging`}
                  description="Add the domain (and grades) so they count in Insights by domain and playbook."
                  href="/journal?review=1"
                  cta="Review trades"
                  compact
                />
              )}

              {statements?.missingDate && (
                <ActionCard
                  icon={Landmark}
                  title={`Upload the statement of ${formatInTz(`${statements.missingDate}T12:00:00Z`, "UTC", "EEE d MMM")}`}
                  description="You traded that day and the broker statement isn't in yet — it confirms the day's P/L."
                  href="/statements/upload"
                  cta="Upload statement"
                  compact
                />
              )}

              {statements?.unsplit && (
                <ActionCard
                  icon={Landmark}
                  title={`Split the statement of ${formatInTz(`${statements.unsplit.tradeDate}T12:00:00Z`, "UTC", "EEE d MMM")} into trades`}
                  description={`${statements.unsplit.products} product${statements.unsplit.products === 1 ? "" : "s"} still one block per instrument${statements.unsplit.days > 1 ? ` (${statements.unsplit.days} days in the last 14)` : ""}. Confirm the suggested split to log each trade.`}
                  href={`/statements/${statements.unsplit.id}#trades`}
                  cta="Split into trades"
                  compact
                />
              )}

              {statements && statements.open > 0 && (
                <ActionCard
                  icon={Landmark}
                  title={`${statements.open} broker product-day${statements.open === 1 ? "" : "s"} not matching the journal`}
                  description={`Last 14 days · journal completeness ${statements.completeness === null ? "—" : `${Math.round(statements.completeness * 100)}%`}. Log or fix the trades so playbook stats rest on complete data.`}
                  href="/statements"
                  cta="Reconcile"
                  compact
                />
              )}

              {data.missingDebrief && state.phase !== "post" && (
                <ActionCard
                  icon={NotebookPen}
                  title={`Debrief ${formatInTz(`${data.missingDebrief}T12:00:00Z`, "UTC", "EEE d MMM")}`}
                  description="You traded that day and the debrief isn't complete yet."
                  href={`/review/${data.missingDebrief}`}
                  cta="Open debrief"
                  compact
                />
              )}
            </ul>
          </section>
        )}

        {state.phase === "closed" && (
          <ActionCard
            icon={Moon}
            title={
              isWeekend(state.date)
                ? "Weekend — markets closed"
                : `Markets closed — ${state.usHoliday}`
            }
            description="Review the week, or prepare for the next session."
            href={`/prep/${nextWeekday}/eu`}
            cta={`Prep ${formatInTz(`${nextWeekday}T12:00:00Z`, "UTC", "EEE d MMM")}`}
            done
          />
        )}

        {blocks.length === 0 && state.phase === "pre_eu" && prepCard("EU")}

        {blocks.length === 0 && state.phase === "eu" && (
          <>
            {!eu && prepCard("EU")}
            {!state.usHoliday && prepCard("US")}
          </>
        )}

        {blocks.length === 0 && state.phase === "us" && !us && prepCard("US")}

        {state.phase === "post" &&
          !hasDebriefBlock &&
          (data.debrief === "complete" ? (
            <ActionCard
              icon={CheckCircle2}
              title="Debrief complete"
              description={`${result.n} trade${result.n === 1 ? "" : "s"} today. Everything stays editable.`}
              href={`/review/${state.date}`}
              cta="Open debrief"
              done
            />
          ) : (
            <ActionCard
              icon={NotebookPen}
              title={data.debrief === "draft" ? "Continue debrief" : "Start debrief"}
              description={`${result.n} trade${result.n === 1 ? "" : "s"} logged today. Plan vs reality, grades, rules, lesson and action items.`}
              href={`/review/${state.date}`}
              cta={data.debrief === "draft" ? "Continue debrief" : "Start debrief"}
            />
          ))}

        {(state.phase === "eu" || state.phase === "us" || state.phase === "pre_eu") &&
          planPrep &&
          (blocks.length > 0 ? (
            <details className="bg-card rounded-xl border" data-testid="full-plan">
              <summary className="heading-caps cursor-pointer px-4 py-3 text-xs">
                Full plan — levels, scenarios, risk, rules
              </summary>
              <div className="border-t p-2">
                <PlanView
                  prep={planPrep.snapshot}
                  events={data.events}
                  instruments={data.instruments}
                  playbooks={data.playbooks}
                  rules={data.rules}
                  result={result}
                  editHref={prepHref(planPrep.snapshot.session)}
                />
              </div>
            </details>
          ) : (
            <PlanView
              prep={planPrep.snapshot}
              events={data.events}
              instruments={data.instruments}
              playbooks={data.playbooks}
              rules={data.rules}
              result={result}
              editHref={prepHref(planPrep.snapshot.session)}
            />
          ))}

        {blocks.length === 0 && (state.phase === "eu" || state.phase === "us") && (
          <div className="flex justify-center">
            <Button asChild size="lg" className="h-14 px-10 text-sm">
              <Link href="/journal/new">
                <Plus aria-hidden />
                Log trade
              </Link>
            </Button>
          </div>
        )}

        {!planPrep && state.phase !== "closed" && data.events.length > 0 && (
          <PlanEventsOnly data={data} />
        )}
      </div>
    </>
  );
}

function PlanEventsOnly({ data }: { data: Awaited<ReturnType<typeof loadNow>> }) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4" aria-label="Today's events">
      <h2 className="heading-caps text-xs">Today&apos;s events</h2>
      <ul className="divide-y rounded-lg border">
        {data.events.map((e) => (
          <li key={e.id} className="flex items-center">
            <div className="min-w-0 flex-1">
              <EventRowButton event={e} />
            </div>
            <Countdown at={e.startsAt} />
          </li>
        ))}
      </ul>
    </section>
  );
}
