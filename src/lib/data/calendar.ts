import "server-only";

import { addMonths, monthKey, ymd, type IsoDate } from "@/lib/calendar/dates";
import { generateFlowEvents } from "@/lib/calendar/flow";
import { HolidayCalendar, type Holiday, type Market } from "@/lib/calendar/holidays";
import { expandTemplates, type CalendarTemplate } from "@/lib/calendar/templates";
import type { CalendarEvent, EventSource } from "@/lib/calendar/types";
import type { DomainCode } from "@/lib/domains";
import { logServerError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from "@/lib/today/state";

export const EVENT_COLUMNS =
  "id, starts_at, native_tz, primary_domain, category, title, importance, instruments, forecast, previous, actual, notes, source, generator_key";

type EventRow = {
  id: string;
  starts_at: string;
  native_tz: string;
  primary_domain: string;
  category: string;
  title: string;
  importance: number;
  instruments: string[];
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  notes: string | null;
  source: string;
  generator_key: string | null;
};

export function toCalendarEvent(r: EventRow): CalendarEvent {
  return {
    id: r.id,
    startsAt: r.starts_at,
    nativeTz: r.native_tz,
    primaryDomain: r.primary_domain as DomainCode,
    category: r.category,
    title: r.title,
    importance: r.importance as 1 | 2 | 3,
    instruments: r.instruments,
    forecast: r.forecast,
    previous: r.previous,
    actual: r.actual,
    notes: r.notes,
    source: r.source as EventSource,
    generated: r.generator_key !== null && r.source === "generated",
  };
}

export async function loadHolidays(): Promise<(Holiday & { id: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("id, date, market, name, early_close")
    .is("deleted_at", null)
    .order("date");
  if (error) throw error;
  return (data ?? []).map((h) => ({
    id: h.id,
    date: h.date,
    market: h.market as Market,
    name: h.name,
    earlyClose: h.early_close ? h.early_close.slice(0, 5) : null,
  }));
}

export async function loadHolidayCalendar() {
  return new HolidayCalendar(await loadHolidays());
}

export async function loadTemplates(): Promise<CalendarTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_templates")
    .select(
      "id, title, category, primary_domain, importance, instruments, weekday, local_time, tz, active",
    )
    .is("deleted_at", null)
    .order("sort");
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    primaryDomain: t.primary_domain as DomainCode,
    importance: t.importance as 1 | 2 | 3,
    instruments: t.instruments,
    weekday: t.weekday,
    localTime: t.local_time,
    tz: t.tz,
    active: t.active,
  }));
}

export type AppSettings = SessionSettings & {
  eventBannerMinutes: number;
  euSessionStart: string;
  euSessionTz: string;
  usSessionEnd: string;
};

export async function loadSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select(
      "eu_prep_by, eu_prep_tz, us_session_start, us_session_end, us_session_tz, eu_session_start, eu_session_tz, event_banner_minutes",
    )
    .maybeSingle();
  if (error) throw error;
  if (!data)
    return {
      ...DEFAULT_SESSION_SETTINGS,
      eventBannerMinutes: 10,
      euSessionStart: "07:00",
      euSessionTz: "Europe/London",
      usSessionEnd: "17:00",
    };
  return {
    euPrepBy: data.eu_prep_by.slice(0, 5),
    euPrepTz: data.eu_prep_tz,
    usSessionStart: data.us_session_start.slice(0, 5),
    usSessionTz: data.us_session_tz,
    usSessionEnd: data.us_session_end.slice(0, 5),
    euSessionStart: data.eu_session_start.slice(0, 5),
    euSessionTz: data.eu_session_tz,
    eventBannerMinutes: data.event_banner_minutes,
  };
}

/**
 * Make sure generated FLOW events and recurring-template occurrences exist
 * for `months` months from year/month. Idempotent and cheap when nothing
 * changed. A failure is logged and never blocks the page: the calendar still
 * shows everything already stored.
 */
export async function syncGenerated(
  year: number,
  month: number,
  months: number,
  cal: HolidayCalendar,
  templates: CalendarTemplate[],
) {
  const end = addMonths(year, month, months);
  const from: IsoDate = ymd(year, month, 1);
  const to: IsoDate = ymd(end.year, end.month, 1);
  const events = [
    ...generateFlowEvents(year, month, months, cal),
    ...expandTemplates(templates, from, to, cal),
  ];
  const supabase = await createClient();
  const { error } = await supabase.rpc("sync_generated_events", {
    p_from: `${from}T00:00:00Z`,
    p_to: `${to}T00:00:00Z`,
    p_events: events,
  });
  if (error) {
    await logServerError("calendar.syncGenerated", error, {
      window: `${monthKey(year, month)}+${months}`,
    });
  }
}

export async function loadEvents(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(EVENT_COLUMNS)
    .is("deleted_at", null)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at")
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map(toCalendarEvent);
}
