import { isWeekend, type IsoDate } from "@/lib/calendar/dates";
import type { HolidayCalendar } from "@/lib/calendar/holidays";
import { dateInTz, DISPLAY_TZ, zonedWallTimeToUtc } from "@/lib/time";

/**
 * What Today should show, from Lisbon time and the exchange calendar.
 * Session boundaries are defined in their native zones, so the Lisbon clock
 * times move automatically around the EU/US DST gaps.
 *
 *   closed   weekend, or both US and UK closed
 *   pre_eu   before the EU prep deadline (default 08:00 Lisbon)
 *   eu       EU session, until the US session starts (default 08:00 NY)
 *   us       US session, until the US cash close (16:00 NY or early close)
 *   post     after the close → debrief
 */
export type TodayPhase = "closed" | "pre_eu" | "eu" | "us" | "post";

export type SessionSettings = {
  euPrepBy: string; // HH:mm
  euPrepTz: string;
  usSessionStart: string; // HH:mm
  usSessionTz: string;
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  euPrepBy: "08:00",
  euPrepTz: "Europe/Lisbon",
  usSessionStart: "08:00",
  usSessionTz: "America/New_York",
};

export type TodayState = {
  phase: TodayPhase;
  date: IsoDate; // Lisbon trading day
  /** The session whose prep is relevant now. */
  session: "EU" | "US" | null;
  /** When the current phase ends (UTC ISO), if it ends today. */
  until: string | null;
  usHoliday: string | null;
  usEarlyClose: string | null;
  usStart: string | null;
  usClose: string | null;
};

const EU_CASH_CLOSE = { time: "17:30", tz: "Europe/Berlin" };

function at(date: IsoDate, time: string, tz: string) {
  return zonedWallTimeToUtc(`${date} ${time.slice(0, 5)}`, tz);
}

export function todayState(
  now: Date,
  cal: HolidayCalendar,
  s: SessionSettings = DEFAULT_SESSION_SETTINGS,
): TodayState {
  const date = dateInTz(now, DISPLAY_TZ);
  const usHoliday = cal.isClosed(date, "US") ? (cal.get(date, "US")?.name ?? "US holiday") : null;
  const usEarlyClose = cal.earlyClose(date, "US");
  const base = { date, usHoliday, usEarlyClose, usStart: null, usClose: null };

  if (isWeekend(date) || (usHoliday && cal.isClosed(date, "UK"))) {
    return { ...base, phase: "closed", session: null, until: null };
  }

  const euPrepBy = at(date, s.euPrepBy, s.euPrepTz);
  if (usHoliday) {
    const euClose = at(date, EU_CASH_CLOSE.time, EU_CASH_CLOSE.tz);
    if (now < euPrepBy)
      return { ...base, phase: "pre_eu", session: "EU", until: euPrepBy.toISOString() };
    if (now < euClose) return { ...base, phase: "eu", session: "EU", until: euClose.toISOString() };
    return { ...base, phase: "post", session: null, until: null };
  }

  const usStart = at(date, s.usSessionStart, s.usSessionTz);
  const usClose = at(date, usEarlyClose ?? "16:00", "America/New_York");
  const withUs = { ...base, usStart: usStart.toISOString(), usClose: usClose.toISOString() };
  if (now < euPrepBy)
    return { ...withUs, phase: "pre_eu", session: "EU", until: euPrepBy.toISOString() };
  if (now < usStart) return { ...withUs, phase: "eu", session: "EU", until: usStart.toISOString() };
  if (now < usClose) return { ...withUs, phase: "us", session: "US", until: usClose.toISOString() };
  return { ...withUs, phase: "post", session: null, until: null };
}

/** The prep the `P` shortcut opens: EU until the US session starts, then US. */
export function currentPrepSession(state: TodayState): "EU" | "US" {
  if (state.phase === "us" || state.phase === "post") return state.usHoliday ? "EU" : "US";
  return "EU";
}
