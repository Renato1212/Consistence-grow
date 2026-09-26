"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Newspaper, Plus, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addMonths,
  isoWeekday,
  parseMonth,
  startOfIsoWeek,
  ymd,
} from "@/lib/calendar/dates";
import { HolidayCalendar, type Holiday } from "@/lib/calendar/holidays";
import { sessionMarkers } from "@/lib/calendar/markers";
import type { CalendarEvent, SessionMarker } from "@/lib/calendar/types";
import { lisbonTime, nativeTime } from "@/lib/calendar/display";
import { monthGrid } from "@/lib/journal/heatmap";
import { dateInTz, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DomainDot, EventTime, ImportanceBars } from "./event-bits";
import { EventSheet } from "./event-sheet";
import { HeadlineDialog, QuickAddDialog } from "./quick-add";

export type CalendarViewMode = "month" | "week" | "day";

/** Format a calendar date (no time zone involved). */
export function fmtDate(date: string, pattern: string) {
  return formatInTz(`${date}T12:00:00Z`, "UTC", pattern);
}

function shift(view: CalendarViewMode, date: string, dir: 1 | -1) {
  if (view === "day") return addDays(date, dir);
  if (view === "week") return addDays(date, 7 * dir);
  const { year, month } = parseMonth(date);
  const m = addMonths(year, month, dir);
  return ymd(m.year, m.month, 1);
}

function title(view: CalendarViewMode, date: string) {
  if (view === "day") return fmtDate(date, "EEEE d MMMM yyyy");
  if (view === "week") return `Week of ${fmtDate(startOfIsoWeek(date), "d MMM yyyy")}`;
  return fmtDate(date, "MMMM yyyy");
}

const href = (view: CalendarViewMode, date: string) => `/calendar?view=${view}&date=${date}`;

export function CalendarView({
  view,
  date,
  today,
  events,
  holidays,
  symbols,
}: {
  view: CalendarViewMode;
  date: string;
  today: string;
  events: CalendarEvent[];
  holidays: Holiday[];
  symbols: string[];
}) {
  const router = useRouter();
  const cal = useMemo(() => new HolidayCalendar(holidays), [holidays]);
  const [sheet, setSheet] = useState<{ event: CalendarEvent | null; n: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [headline, setHeadline] = useState(false);
  const refresh = () => router.refresh();

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const d = dateInTz(e.startsAt);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return m;
  }, [events]);

  const open = (event: CalendarEvent | null) => setSheet((s) => ({ event, n: (s?.n ?? 0) + 1 }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex rounded-md border p-0.5">
          {(["month", "week", "day"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, date)}
              aria-current={v === view ? "page" : undefined}
              className={cn(
                "heading-caps rounded px-3 py-1.5 text-[11px] transition-colors",
                v === view
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href={href(view, shift(view, date, -1))} aria-label="Previous">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, today)}>Today</Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href={href(view, shift(view, date, 1))} aria-label="Next">
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <h2 className="text-sm font-semibold" data-testid="calendar-title">
          {title(view, date)}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setHeadline(true)}>
            <Newspaper aria-hidden />
            Log headline
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQuickAdd(true)}>
            <Zap aria-hidden />
            Quick add
          </Button>
          <Button size="sm" onClick={() => open(null)}>
            <Plus aria-hidden />
            Event
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <MonthView date={date} today={today} byDay={byDay} cal={cal} onOpen={open} />
      ) : (
        <AgendaView
          days={
            view === "day"
              ? [date]
              : Array.from({ length: 7 }, (_, i) => addDays(startOfIsoWeek(date), i))
          }
          today={today}
          byDay={byDay}
          cal={cal}
          onOpen={open}
          showEmpty={view === "day"}
        />
      )}

      <p className="text-muted-foreground text-xs">
        Times in Lisbon; the release&apos;s own time in grey. FLOW dates marked{" "}
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          generated
        </Badge>{" "}
        are computed from exchange rules and the holiday list (Settings → Calendar).
      </p>

      {sheet && (
        <EventSheet
          key={sheet.n}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          event={sheet.event}
          defaultDate={date}
          symbols={symbols}
          onChanged={refresh}
        />
      )}
      {quickAdd && (
        <QuickAddDialog open onOpenChange={setQuickAdd} defaultDate={date} onChanged={refresh} />
      )}
      {headline && (
        <HeadlineDialog open onOpenChange={setHeadline} symbols={symbols} onChanged={refresh} />
      )}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthView({
  date,
  today,
  byDay,
  cal,
  onOpen,
}: {
  date: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  cal: HolidayCalendar;
  onOpen: (e: CalendarEvent) => void;
}) {
  const { year, month } = parseMonth(date);
  const weeks = monthGrid(year, month);
  return (
    <div className="overflow-hidden rounded-lg border" data-testid="calendar-month">
      <div className="bg-card grid grid-cols-7 border-b">
        {WEEKDAYS.map((d) => (
          <div key={d} className="heading-caps text-muted-foreground px-2 py-1.5 text-[10px]">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((d, di) => {
            if (!d)
              return (
                <div
                  key={di}
                  className="bg-muted/20 min-h-16 border-r last:border-r-0 sm:min-h-24"
                />
              );
            const list = byDay.get(d) ?? [];
            const holiday = cal.get(d, "US") ?? cal.get(d, "UK");
            return (
              <div
                key={d}
                data-date={d}
                className={cn(
                  "min-h-16 min-w-0 border-r p-1 last:border-r-0 sm:min-h-24 sm:p-1.5",
                  isoWeekday(d) >= 6 && "bg-muted/20",
                )}
              >
                <Link
                  href={href("day", d)}
                  className={cn(
                    "num inline-flex size-6 items-center justify-center rounded-full text-xs hover:underline",
                    d === today && "bg-primary text-primary-foreground font-bold",
                  )}
                  aria-label={fmtDate(d, "EEEE d MMMM")}
                >
                  {Number(d.slice(8))}
                </Link>
                {holiday && (
                  <div className="text-muted-foreground truncate text-[10px]" title={holiday.name}>
                    {holiday.market} {holiday.earlyClose ? "early close" : "holiday"}
                  </div>
                )}
                {/* Phone: dots only; tap the day for details */}
                <div className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                  {list.slice(0, 6).map((e) => (
                    <DomainDot key={e.id} code={e.primaryDomain} />
                  ))}
                </div>
                <ul className="mt-0.5 hidden space-y-0.5 sm:block">
                  {list.slice(0, 3).map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(e)}
                        className={cn(
                          "hover:bg-muted flex w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[11px]",
                          e.importance === 3 && "font-semibold",
                        )}
                      >
                        <DomainDot code={e.primaryDomain} className="size-1.5" />
                        <span className="num text-muted-foreground shrink-0">
                          {lisbonTime(e.startsAt)}
                        </span>
                        <span className="truncate">{e.title}</span>
                      </button>
                    </li>
                  ))}
                  {list.length > 3 && (
                    <li>
                      <Link
                        href={href("day", d)}
                        className="text-muted-foreground px-1 text-[11px] hover:underline"
                      >
                        +{list.length - 3} more
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type Row =
  | { kind: "event"; at: string; event: CalendarEvent }
  | { kind: "marker"; at: string; marker: SessionMarker };

function AgendaView({
  days,
  today,
  byDay,
  cal,
  onOpen,
  showEmpty,
}: {
  days: string[];
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  cal: HolidayCalendar;
  onOpen: (e: CalendarEvent) => void;
  showEmpty: boolean;
}) {
  return (
    <div className="space-y-4" data-testid="calendar-agenda">
      {days.map((d) => {
        const events = byDay.get(d) ?? [];
        if (!showEmpty && events.length === 0 && isoWeekday(d) >= 6) return null;
        const markers = sessionMarkers(d, cal);
        // Day view interleaves session markers; week view keeps them to one line.
        const rows: Row[] = [
          ...events.map((event) => ({ kind: "event" as const, at: event.startsAt, event })),
          ...(showEmpty
            ? markers.map((marker) => ({ kind: "marker" as const, at: marker.at, marker }))
            : []),
        ].sort((a, b) => a.at.localeCompare(b.at));
        const holidays = [cal.get(d, "US"), cal.get(d, "UK")].filter(Boolean) as Holiday[];
        return (
          <section key={d} aria-label={fmtDate(d, "EEEE d MMMM")} className="space-y-1.5">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Link
                href={href("day", d)}
                className={cn("hover:underline", d === today && "text-primary")}
              >
                {fmtDate(d, "EEE d MMM")}
              </Link>
              {d === today && <Badge className="text-[10px]">Today</Badge>}
              {holidays.map((h) => (
                <Badge key={h.market} variant="outline" className="text-[10px]">
                  {h.market}: {h.name}
                  {h.earlyClose ? ` (closes ${h.earlyClose})` : ""}
                </Badge>
              ))}
            </h3>
            {!showEmpty && markers.length > 0 && (
              <p className="text-muted-foreground num text-[11px]">
                {markers.map((m) => `${m.label} ${lisbonTime(m.at)}`).join(" · ")}
              </p>
            )}
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing scheduled.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {rows.map((r) =>
                  r.kind === "marker" ? (
                    <li
                      key={r.marker.key}
                      className="text-muted-foreground flex items-center gap-3 px-3 py-1.5 text-xs"
                    >
                      <span className="num w-28 shrink-0">
                        {lisbonTime(r.at)}{" "}
                        <span className="text-[10px]">{nativeTime(r.at, r.marker.tz)}</span>
                      </span>
                      <span className="heading-caps text-[10px]">{r.marker.label}</span>
                    </li>
                  ) : (
                    <li key={r.event.id}>
                      <EventRowButton event={r.event} onOpen={onOpen} />
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function EventRowButton({
  event: e,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen?: (e: CalendarEvent) => void;
}) {
  const body = (
    <>
      <span className="w-28 shrink-0 text-sm">
        <EventTime event={e} />
      </span>
      <DomainDot code={e.primaryDomain} />
      <span
        className={cn("min-w-0 flex-1 truncate text-sm", e.importance === 3 && "font-semibold")}
      >
        {e.title}
        {e.instruments.length > 0 && (
          <span className="text-muted-foreground ml-2 text-xs">
            {e.instruments.slice(0, 4).join(" ")}
          </span>
        )}
      </span>
      {e.generated && (
        <Badge variant="outline" className="hidden px-1 py-0 text-[10px] sm:inline-flex">
          generated
        </Badge>
      )}
      {e.actual && <span className="num text-xs">A: {e.actual}</span>}
      <ImportanceBars level={e.importance} />
    </>
  );
  if (!onOpen) return <div className="flex items-center gap-3 px-3 py-2">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      data-testid="calendar-event"
      className="hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2 text-left"
    >
      {body}
    </button>
  );
}
