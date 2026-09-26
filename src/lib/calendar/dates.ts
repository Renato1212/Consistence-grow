/**
 * Calendar-date arithmetic on ISO `yyyy-MM-dd` strings. Pure date maths in
 * UTC, so no time zone or DST can shift a day.
 */
export type IsoDate = string;

function toUtc(d: IsoDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUtc(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function ymd(year: number, month: number, day: number): IsoDate {
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: IsoDate): number {
  const w = toUtc(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export function isWeekend(d: IsoDate): boolean {
  return isoWeekday(d) >= 6;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-09" → { year: 2026, month: 9 } */
export function parseMonth(ym: string): { year: number; month: number } {
  const [year, month] = ym.split("-").map(Number);
  return { year, month };
}

export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Monday of the ISO week containing `d`. */
export function startOfIsoWeek(d: IsoDate): IsoDate {
  return addDays(d, 1 - isoWeekday(d));
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}
