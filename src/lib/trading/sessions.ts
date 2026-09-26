import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Session assignment and time buckets. Mirrors public.compute_trade() in SQL.
 * Session boundaries are defined in each session's native time zone, so the
 * EU/US daylight-saving gaps resolve automatically.
 */
export type Session = "ASIA" | "EU" | "US";

export type SessionSettings = {
  usTz: string;
  usStart: string; // "HH:mm" in usTz
  usEnd: string;
  euTz: string;
  euStart: string; // "HH:mm" in euTz; EU runs until the US start
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  usTz: "America/New_York",
  usStart: "08:00",
  usEnd: "17:00",
  euTz: "Europe/London",
  euStart: "07:00",
};

function wallTimeOnDate(instant: Date, tz: string, hhmm: string): Date {
  const day = formatInTimeZone(instant, tz, "yyyy-MM-dd");
  return fromZonedTime(`${day} ${hhmm}`, tz);
}

export function sessionFor(
  entryAt: Date | string,
  settings: SessionSettings = DEFAULT_SESSION_SETTINGS,
): Session {
  const t = new Date(entryAt);
  const usStart = wallTimeOnDate(t, settings.usTz, settings.usStart);
  const usEnd = wallTimeOnDate(t, settings.usTz, settings.usEnd);
  const euStart = wallTimeOnDate(t, settings.euTz, settings.euStart);
  if (t >= usStart && t < usEnd) return "US";
  if (t >= euStart && t < usStart) return "EU";
  return "ASIA";
}

/** 30-minute bucket label ("HH:mm") of an instant in the exchange time zone. */
export function timeBucket(entryAt: Date | string, exchangeTz: string): string {
  const [h, m] = formatInTimeZone(new Date(entryAt), exchangeTz, "HH:mm").split(":");
  return `${h}:${Number(m) < 30 ? "00" : "30"}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) in the exchange time zone. */
export function isoWeekday(entryAt: Date | string, exchangeTz: string): number {
  return Number(formatInTimeZone(new Date(entryAt), exchangeTz, "i"));
}
