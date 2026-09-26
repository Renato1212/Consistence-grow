import type { DomainCode } from "@/lib/domains";
import { zonedWallTimeToUtc } from "@/lib/time";

import { addDays, isoWeekday, startOfIsoWeek, type IsoDate } from "./dates";
import type { HolidayCalendar } from "./holidays";
import type { GeneratedEvent } from "./types";

export type CalendarTemplate = {
  id: string;
  title: string;
  category: string;
  primaryDomain: DomainCode;
  importance: 1 | 2 | 3;
  instruments: string[];
  weekday: number; // ISO 1–5 in `tz`
  localTime: string; // HH:mm[:ss]
  tz: string;
  active: boolean;
};

export const WEEKDAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Occurrences of active weekly templates in [from, to). A release that falls
 * on a US holiday is skipped; in a week with a US holiday it is kept but
 * flagged, because agencies often shift those releases.
 */
export function expandTemplates(
  templates: CalendarTemplate[],
  from: IsoDate,
  to: IsoDate,
  cal: HolidayCalendar,
): GeneratedEvent[] {
  const out: GeneratedEvent[] = [];
  for (const t of templates) {
    if (!t.active) continue;
    for (let d = from; d < to; d = addDays(d, 1)) {
      if (isoWeekday(d) !== t.weekday || cal.isClosed(d, "US")) continue;
      const monday = startOfIsoWeek(d);
      let holidayWeek = false;
      for (let i = 0; i < 5; i++) if (cal.isClosed(addDays(monday, i), "US")) holidayWeek = true;
      out.push({
        generator_key: `tpl:${t.id}:${d}`,
        starts_at: zonedWallTimeToUtc(`${d} ${t.localTime.slice(0, 5)}`, t.tz).toISOString(),
        native_tz: t.tz,
        primary_domain: t.primaryDomain,
        category: t.category,
        title: t.title,
        importance: t.importance,
        instruments: t.instruments,
        notes: holidayWeek ? "Holiday week — the release time may shift. Verify." : null,
        source: "preset",
      });
    }
  }
  return out;
}
