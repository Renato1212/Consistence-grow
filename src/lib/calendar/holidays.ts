import { addDays, isWeekend, type IsoDate } from "./dates";

/**
 * Exchange holidays. `US` = NYSE (CME equity/rates cash-hours follow it),
 * `UK` = England & Wales bank holidays (London fix, UK cash).
 * The list is editable in Settings → Calendar and needs a yearly review.
 */
export type Market = "US" | "UK";

export const MARKETS: Record<Market, { label: string; tz: string }> = {
  US: { label: "US (NYSE)", tz: "America/New_York" },
  UK: { label: "UK (London)", tz: "Europe/London" },
};

export type Holiday = {
  date: IsoDate;
  market: Market;
  name: string;
  /** "HH:mm" early close in the market's zone; null = closed all day. */
  earlyClose: string | null;
};

/**
 * Seed list for 2026–2027, from the NYSE Group holiday calendar and GOV.UK
 * bank holidays. Mirrored by `private.seed_phase3_defaults()`.
 */
export const DEFAULT_HOLIDAYS: Holiday[] = [
  { market: "US", date: "2026-01-01", name: "New Year's Day", earlyClose: null },
  { market: "US", date: "2026-01-19", name: "Martin Luther King Jr. Day", earlyClose: null },
  { market: "US", date: "2026-02-16", name: "Washington's Birthday", earlyClose: null },
  { market: "US", date: "2026-04-03", name: "Good Friday", earlyClose: null },
  { market: "US", date: "2026-05-25", name: "Memorial Day", earlyClose: null },
  { market: "US", date: "2026-06-19", name: "Juneteenth", earlyClose: null },
  { market: "US", date: "2026-07-03", name: "Independence Day (observed)", earlyClose: null },
  { market: "US", date: "2026-09-07", name: "Labor Day", earlyClose: null },
  { market: "US", date: "2026-11-26", name: "Thanksgiving Day", earlyClose: null },
  { market: "US", date: "2026-11-27", name: "Day after Thanksgiving", earlyClose: "13:00" },
  { market: "US", date: "2026-12-24", name: "Christmas Eve", earlyClose: "13:00" },
  { market: "US", date: "2026-12-25", name: "Christmas Day", earlyClose: null },
  { market: "US", date: "2027-01-01", name: "New Year's Day", earlyClose: null },
  { market: "US", date: "2027-01-18", name: "Martin Luther King Jr. Day", earlyClose: null },
  { market: "US", date: "2027-02-15", name: "Washington's Birthday", earlyClose: null },
  { market: "US", date: "2027-03-26", name: "Good Friday", earlyClose: null },
  { market: "US", date: "2027-05-31", name: "Memorial Day", earlyClose: null },
  { market: "US", date: "2027-06-18", name: "Juneteenth (observed)", earlyClose: null },
  { market: "US", date: "2027-07-05", name: "Independence Day (observed)", earlyClose: null },
  { market: "US", date: "2027-09-06", name: "Labor Day", earlyClose: null },
  { market: "US", date: "2027-11-25", name: "Thanksgiving Day", earlyClose: null },
  { market: "US", date: "2027-11-26", name: "Day after Thanksgiving", earlyClose: "13:00" },
  { market: "US", date: "2027-12-24", name: "Christmas Day (observed)", earlyClose: null },
  { market: "UK", date: "2026-01-01", name: "New Year's Day", earlyClose: null },
  { market: "UK", date: "2026-04-03", name: "Good Friday", earlyClose: null },
  { market: "UK", date: "2026-04-06", name: "Easter Monday", earlyClose: null },
  { market: "UK", date: "2026-05-04", name: "Early May bank holiday", earlyClose: null },
  { market: "UK", date: "2026-05-25", name: "Spring bank holiday", earlyClose: null },
  { market: "UK", date: "2026-08-31", name: "Summer bank holiday", earlyClose: null },
  { market: "UK", date: "2026-12-25", name: "Christmas Day", earlyClose: null },
  { market: "UK", date: "2026-12-28", name: "Boxing Day (substitute)", earlyClose: null },
  { market: "UK", date: "2027-01-01", name: "New Year's Day", earlyClose: null },
  { market: "UK", date: "2027-03-26", name: "Good Friday", earlyClose: null },
  { market: "UK", date: "2027-03-29", name: "Easter Monday", earlyClose: null },
  { market: "UK", date: "2027-05-03", name: "Early May bank holiday", earlyClose: null },
  { market: "UK", date: "2027-05-31", name: "Spring bank holiday", earlyClose: null },
  { market: "UK", date: "2027-08-30", name: "Summer bank holiday", earlyClose: null },
  { market: "UK", date: "2027-12-27", name: "Christmas Day (substitute)", earlyClose: null },
  { market: "UK", date: "2027-12-28", name: "Boxing Day (substitute)", earlyClose: null },
];

export class HolidayCalendar {
  private readonly byKey = new Map<string, Holiday>();

  constructor(holidays: Holiday[]) {
    for (const h of holidays) this.byKey.set(`${h.market}:${h.date}`, h);
  }

  get(date: IsoDate, market: Market): Holiday | undefined {
    return this.byKey.get(`${market}:${date}`);
  }

  /** Closed all day (early-close days are still business days). */
  isClosed(date: IsoDate, market: Market): boolean {
    const h = this.get(date, market);
    return !!h && h.earlyClose === null;
  }

  earlyClose(date: IsoDate, market: Market): string | null {
    return this.get(date, market)?.earlyClose ?? null;
  }

  isBusinessDay(date: IsoDate, market: Market): boolean {
    return !isWeekend(date) && !this.isClosed(date, market);
  }

  /** `date` itself if it is a business day, else the nearest earlier one. */
  onOrBefore(date: IsoDate, market: Market): IsoDate {
    let d = date;
    while (!this.isBusinessDay(d, market)) d = addDays(d, -1);
    return d;
  }

  /** Latest year covered by the list for a market (for the "review yearly" warning). */
  lastYear(market: Market): number | null {
    let max: number | null = null;
    for (const h of this.byKey.values()) {
      if (h.market !== market) continue;
      const y = Number(h.date.slice(0, 4));
      if (max === null || y > max) max = y;
    }
    return max;
  }
}
