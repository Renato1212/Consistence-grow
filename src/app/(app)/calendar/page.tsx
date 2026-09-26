import type { Metadata } from "next";

import { CalendarView, type CalendarViewMode } from "@/components/calendar/calendar-view";
import { PageHeader } from "@/components/shell/empty-state";
import {
  addDays,
  addMonths,
  isIsoDate,
  parseMonth,
  startOfIsoWeek,
  ymd,
} from "@/lib/calendar/dates";
import { HolidayCalendar } from "@/lib/calendar/holidays";
import { loadEvents, loadHolidays, loadTemplates, syncGenerated } from "@/lib/data/calendar";
import { loadActiveSymbols } from "@/lib/data/instruments";
import { DISPLAY_TZ, lisbonToday, zonedWallTimeToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Calendar" };

function range(view: CalendarViewMode, date: string): { start: string; end: string } {
  if (view === "day") return { start: date, end: addDays(date, 1) };
  if (view === "week") {
    const start = startOfIsoWeek(date);
    return { start, end: addDays(start, 7) };
  }
  const { year, month } = parseMonth(date);
  const next = addMonths(year, month, 1);
  const start = startOfIsoWeek(ymd(year, month, 1));
  return { start, end: addDays(startOfIsoWeek(ymd(next.year, next.month, 1)), 7) };
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const sp = await searchParams;
  const today = lisbonToday();
  const view: CalendarViewMode = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const date = typeof sp.date === "string" && isIsoDate(sp.date) ? sp.date : today;

  const [holidays, templates, symbols] = await Promise.all([
    loadHolidays(),
    loadTemplates(),
    loadActiveSymbols(),
  ]);
  const cal = new HolidayCalendar(holidays);
  const { year, month } = parseMonth(date);
  const from = addMonths(year, month, -1);
  await syncGenerated(from.year, from.month, 4, cal, templates);

  const { start, end } = range(view, date);
  const events = await loadEvents(
    zonedWallTimeToUtc(`${start} 00:00`, DISPLAY_TZ).toISOString(),
    zonedWallTimeToUtc(`${end} 00:00`, DISPLAY_TZ).toISOString(),
  );

  return (
    <>
      <PageHeader title="Calendar" />
      <CalendarView
        view={view}
        date={date}
        today={today}
        events={events}
        holidays={holidays}
        symbols={symbols}
      />
    </>
  );
}
