import { zonedWallTimeToUtc } from "@/lib/time";

import { addDays, addMonths, daysInMonth, isoWeekday, monthKey, ymd, type IsoDate } from "./dates";
import type { HolidayCalendar } from "./holidays";
import type { GeneratedEvent } from "./types";

/**
 * Deterministic FLOW events. All rules are verified against published
 * calendars in flow.test.ts.
 */

export function thirdFriday(year: number, month: number): IsoDate {
  const first = ymd(year, month, 1);
  const offset = (5 - isoWeekday(first) + 7) % 7; // days to the first Friday
  return addDays(first, offset + 14);
}

/**
 * Standard monthly equity/index options expiration: the third Friday, or the
 * preceding business day when that Friday is an exchange holiday
 * (e.g. Good Friday 18 Apr 2025 → Thu 17 Apr; Juneteenth 19 Jun 2026 → Thu 18 Jun).
 */
export function monthlyOpex(year: number, month: number, cal: HolidayCalendar): IsoDate {
  return cal.onOrBefore(thirdFriday(year, month), "US");
}

export function isQuarterMonth(month: number) {
  return month % 3 === 0;
}

/**
 * Cboe VIX monthly expiration: the Wednesday 30 days before the next month's
 * standard SPX expiration (third Friday). If that Friday is a holiday, count
 * back from the preceding business day (→ Tuesday); if the resulting day is
 * itself a holiday, use the business day before it.
 */
export function vixExpiry(year: number, month: number, cal: HolidayCalendar): IsoDate {
  const next = addMonths(year, month, 1);
  const spx = monthlyOpex(next.year, next.month, cal);
  return cal.onOrBefore(addDays(spx, -30), "US");
}

export function lastBusinessDay(
  year: number,
  month: number,
  cal: HolidayCalendar,
  market: "US" | "UK",
): IsoDate {
  return cal.onOrBefore(ymd(year, month, daysInMonth(year, month)), market);
}

function periodLabel(month: number) {
  if (month === 12) return "Year-end";
  if (isQuarterMonth(month)) return "Quarter-end";
  return "Month-end";
}

const EQUITY_INDEX = ["ES", "NQ", "RTY", "YM"];
const FX = ["6E", "6B", "6J", "6A"];

function at(date: IsoDate, time: string, tz: string) {
  return zonedWallTimeToUtc(`${date} ${time}`, tz).toISOString();
}

/** FLOW events for `months` calendar months starting at year/month. */
export function generateFlowEvents(
  year: number,
  month: number,
  months: number,
  cal: HolidayCalendar,
): GeneratedEvent[] {
  const out: GeneratedEvent[] = [];
  for (let i = 0; i < months; i++) {
    const { year: y, month: m } = addMonths(year, month, i);
    const key = monthKey(y, m);
    const ny = "America/New_York";
    const ldn = "Europe/London";

    const opex = monthlyOpex(y, m, cal);
    const quad = isQuarterMonth(m);
    out.push({
      generator_key: `opex:${key}`,
      starts_at: at(opex, "09:30", ny),
      native_tz: ny,
      primary_domain: "FLOW",
      category: quad ? "Quad witching" : "Options expiration",
      title: quad ? "Quad witching (quarterly OPEX)" : "Monthly OPEX",
      importance: quad ? 3 : 2,
      instruments: EQUITY_INDEX,
      notes:
        opex !== thirdFriday(y, m)
          ? "Moved to Thursday: the third Friday is an exchange holiday."
          : null,
      source: "generated",
    });

    const vix = vixExpiry(y, m, cal);
    out.push({
      generator_key: `vix:${key}`,
      starts_at: at(vix, "09:30", ny),
      native_tz: ny,
      primary_domain: "FLOW",
      category: "Options expiration",
      title: "VIX expiration",
      importance: 2,
      instruments: ["ES"],
      notes: isoWeekday(vix) !== 3 ? "Not a Wednesday: holiday adjustment (Cboe rule)." : null,
      source: "generated",
    });

    const label = periodLabel(m);
    const usLast = lastBusinessDay(y, m, cal, "US");
    const usClose = cal.earlyClose(usLast, "US") ?? "16:00";
    out.push({
      generator_key: `monthend:${key}`,
      starts_at: at(usLast, usClose, ny),
      native_tz: ny,
      primary_domain: "FLOW",
      category: "Rebalancing",
      title: `${label} — US close rebalancing`,
      importance: label === "Month-end" ? 2 : 3,
      instruments: ["ES", "NQ", "ZN"],
      notes: null,
      source: "generated",
    });

    const ukLast = lastBusinessDay(y, m, cal, "UK");
    out.push({
      generator_key: `fix:${key}`,
      starts_at: at(ukLast, "16:00", ldn),
      native_tz: ldn,
      primary_domain: "FLOW",
      category: "London fix",
      title: `${label} — London 4pm fix`,
      importance: label === "Month-end" ? 2 : 3,
      instruments: FX,
      notes: "WM/Reuters 4pm London fixing window (15:55–16:05 London).",
      source: "generated",
    });
  }
  return out;
}
