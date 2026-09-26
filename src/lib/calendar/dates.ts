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

/** ISO-8601 week of a date: weeks start Monday; week 1 contains the year's first Thursday. */
export function isoWeekOf(d: IsoDate): { year: number; week: number } {
  const thursday = addDays(d, 4 - isoWeekday(d));
  const year = Number(thursday.slice(0, 4));
  const jan1 = ymd(year, 1, 1);
  const dayOfYear = Math.round((toUtc(thursday).getTime() - toUtc(jan1).getTime()) / 86_400_000);
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** Monday of ISO week `week` of `year`. */
export function isoWeekStart(year: number, week: number): IsoDate {
  const jan4 = ymd(year, 1, 4);
  return addDays(startOfIsoWeek(jan4), (week - 1) * 7);
}

/** "2026-W40" */
export function isoWeekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseIsoWeekKey(key: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // Week 53 only exists in some years.
  if (isoWeekOf(isoWeekStart(year, week)).year !== year) return null;
  return { year, week };
}
