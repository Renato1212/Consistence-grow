/**
 * What an analysis request looks at: a global Insights filter plus kind,
 * schedule slot and ISO week. Pure, shared by the browser (queue a request,
 * recognise a cached result) and the queue endpoint (scheduled slots).
 */
import {
  addDays,
  isoWeekKey,
  isoWeekOf,
  isoWeekday,
  isoWeekStart,
  isWeekend,
  parseIsoWeekKey,
} from "@/lib/calendar/dates";
import type { HolidayCalendar } from "@/lib/calendar/holidays";
import {
  DEFAULT_FILTER,
  filterChips,
  filterToQuery,
  RANGE_LABEL,
  type Filter,
} from "@/lib/insights/filters";

export type AiKind = "filter" | "weekly" | "session";
export type AiSlot = "eu" | "us" | "weekly";
export const AI_SLOTS: AiSlot[] = ["eu", "us", "weekly"];

export type RequestSpec = {
  kind: AiKind;
  slot: AiSlot | null;
  label: string;
  filter: Filter;
  filterKey: string;
  week: string | null;
};

/** Canonical key of a filter (its URL query), used to find earlier results. */
export function filterKey(f: Filter): string {
  return filterToQuery(f).toString();
}

export function filterLabel(f: Filter): string {
  const range = f.range === "custom" ? `${f.from ?? "…"} → ${f.to ?? "…"}` : RANGE_LABEL[f.range];
  const kinds =
    f.kinds.length === 1 && f.kinds[0] === "taken" ? [] : [`Kinds: ${f.kinds.join(", ")}`];
  const label = [range, ...kinds, ...filterChips(f).map((c) => c.label)].join(" · ");
  return label.length > 200 ? `${label.slice(0, 197)}…` : label;
}

export function filterRequest(f: Filter): RequestSpec {
  return {
    kind: "filter",
    slot: null,
    label: filterLabel(f),
    filter: f,
    filterKey: filterKey(f),
    week: null,
  };
}

/** Pre-session analysis: that session's taken trades over the last 90 days. */
export function sessionRequest(session: "EU" | "US"): RequestSpec {
  const filter: Filter = { ...DEFAULT_FILTER, range: "90d", values: { session: [session] } };
  return {
    kind: "session",
    slot: session === "EU" ? "eu" : "us",
    label: `Pre-${session} session · ${session} trades, last 90 days`,
    filter,
    filterKey: filterKey(filter),
    week: null,
  };
}

/** Weekly review of one ISO week (Lisbon trading dates). */
export function weeklyRequest(week: string): RequestSpec | null {
  const w = parseIsoWeekKey(week);
  if (!w) return null;
  const from = isoWeekStart(w.year, w.week);
  const filter: Filter = { ...DEFAULT_FILTER, range: "custom", from, to: addDays(from, 6) };
  return {
    kind: "weekly",
    slot: "weekly",
    label: `Weekly review · ${week}`,
    filter,
    filterKey: filterKey(filter),
    week,
  };
}

/** The week a Saturday/Sunday review covers; on weekdays the previous week. */
export function reviewWeek(today: string): string {
  const d = isoWeekday(today) >= 6 ? today : addDays(today, -7);
  const w = isoWeekOf(d);
  return isoWeekKey(w.year, w.week);
}

/** The request a scheduled run should make, or why it skips. */
export function slotRequest(
  slot: AiSlot,
  today: string,
  cal: HolidayCalendar,
): RequestSpec | { skip: string } {
  if (slot === "weekly") return weeklyRequest(reviewWeek(today)) ?? { skip: "bad week" };
  if (isWeekend(today)) return { skip: "weekend" };
  const us = cal.get(today, "US");
  const usClosed = !!us && !us.earlyClose;
  if (slot === "us") return usClosed ? { skip: `US holiday: ${us!.name}` } : sessionRequest("US");
  const uk = cal.get(today, "UK");
  if (usClosed && uk && !uk.earlyClose) return { skip: "US and UK closed" };
  return sessionRequest("EU");
}
