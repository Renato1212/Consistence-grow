import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CheckCircle2, ClipboardPen, Moon, NotebookPen, Plus } from "lucide-react";

import { EventRowButton } from "@/components/calendar/calendar-view";
import { PageHeader } from "@/components/shell/empty-state";
import { Countdown } from "@/components/today/countdown";
import { PlanView } from "@/components/today/plan-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, isWeekend } from "@/lib/calendar/dates";
import { loadToday, type DayResult } from "@/lib/data/today";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import type { SessionCode } from "@/lib/prep/prep-form";
import { formatInTz } from "@/lib/time";
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
  return loadToday(new Date());
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
}: {
  icon: typeof ClipboardPen;
  title: string;
  description: string;
  href: string;
  cta: string;
  done?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center",
        done ? "bg-card" : "border-primary/50 bg-primary/5",
      )}
      data-testid="today-action"
    >
      <Icon
        className={cn("size-8 shrink-0", done ? "text-muted-foreground" : "text-primary")}
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
        {data.actionItems.length > 0 && (
          <section className="border-primary/40 rounded-xl border p-4" aria-label="Action items">
            <h2 className="heading-caps mb-2 text-xs">Open action items</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.actionItems.map((a) => (
                <li key={a.id}>{a.text}</li>
              ))}
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

        {state.phase === "pre_eu" && prepCard("EU")}

        {state.phase === "eu" && (
          <>
            {!eu && prepCard("EU")}
            {!state.usHoliday && prepCard("US")}
          </>
        )}

        {state.phase === "us" && !us && prepCard("US")}

        {state.phase === "post" && (
          <ActionCard
            icon={NotebookPen}
            title="Session over"
            description={`${result.n} trade${result.n === 1 ? "" : "s"} logged today. The guided debrief arrives in the next update — review today's trades in the Journal meanwhile.`}
            href="/journal"
            cta="Open journal"
            done
          />
        )}

        {(state.phase === "eu" || state.phase === "us" || state.phase === "pre_eu") && planPrep && (
          <PlanView
            prep={planPrep.snapshot}
            events={data.events}
            instruments={data.instruments}
            playbooks={data.playbooks}
            rules={data.rules}
            result={result}
            editHref={prepHref(planPrep.snapshot.session)}
          />
        )}

        {(state.phase === "eu" || state.phase === "us") && (
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
