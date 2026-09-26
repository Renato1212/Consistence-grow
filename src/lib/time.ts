import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * All timestamps are stored in UTC. Display is in Lisbon by default, with an
 * optional secondary clock. Session times are defined in their native zone so
 * EU/US DST differences resolve automatically.
 */
export const TZ = {
  lisbon: "Europe/Lisbon",
  london: "Europe/London",
  newYork: "America/New_York",
  chicago: "America/Chicago",
  frankfurt: "Europe/Berlin",
} as const;

export type TimeZoneId = (typeof TZ)[keyof typeof TZ];

export const DISPLAY_TZ: TimeZoneId = TZ.lisbon;

export const SECONDARY_CLOCKS = [
  { id: TZ.newYork, label: "New York", short: "NY" },
  { id: TZ.london, label: "London", short: "LDN" },
] as const;

/** Format a UTC instant as wall-clock time in `tz`. */
export function formatInTz(instant: Date | string | number, tz: string, pattern: string): string {
  return formatInTimeZone(instant, tz, pattern);
}

/**
 * Convert a wall-clock time in `tz` (e.g. "2026-03-20 09:30" in New York) to
 * the UTC instant it represents.
 */
export function zonedWallTimeToUtc(wallTime: string, tz: string): Date {
  return fromZonedTime(wallTime, tz);
}

/** Calendar date (yyyy-MM-dd) of an instant as seen in `tz`. */
export function dateInTz(instant: Date | string | number, tz: string = DISPLAY_TZ): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}
