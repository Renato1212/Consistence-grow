import "server-only";

import { addDays, isoWeekKey, isoWeekOf, isoWeekStart, type IsoDate } from "@/lib/calendar/dates";
import type { FactTrade } from "@/lib/review/stats";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_TZ, zonedWallTimeToUtc } from "@/lib/time";
import {
  FACT_COLUMNS,
  loadDebriefStatuses,
  loadOpenActions,
  toFact,
  type ActionItemRow,
  type DebriefStatus,
} from "./debrief";

export type WeekData = {
  year: number;
  week: number;
  key: string;
  start: IsoDate;
  end: IsoDate; // inclusive Sunday
  prevKey: string;
  nextKey: string;
  trades: FactTrade[];
  violationsByDay: Record<string, number>;
  debriefs: Record<string, DebriefStatus>;
  openActions: ActionItemRow[];
  closedThisWeek: { id: string; text: string; status: string }[];
  review: { reflection: string; goals: string[]; updatedAt: string | null };
};

export async function loadTrades(from: IsoDate, to: IsoDate): Promise<FactTrade[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select(FACT_COLUMNS)
    .gte("trade_date", from)
    .lte("trade_date", to)
    .order("entry_at")
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map(toFact);
}

export async function loadWeek(year: number, week: number): Promise<WeekData> {
  const start = isoWeekStart(year, week);
  const end = addDays(start, 6);
  const prev = isoWeekOf(addDays(start, -7));
  const next = isoWeekOf(addDays(start, 7));
  const supabase = await createClient();
  const weekFrom = zonedWallTimeToUtc(`${start} 00:00`, DISPLAY_TZ).toISOString();
  const weekTo = zonedWallTimeToUtc(`${addDays(end, 1)} 00:00`, DISPLAY_TZ).toISOString();

  const [trades, violations, statuses, openActions, closed, review] = await Promise.all([
    loadTrades(start, end),
    supabase
      .from("rule_checks")
      .select("followed, trading_days!inner(date)")
      .eq("context", "debrief")
      .eq("followed", false)
      .gte("trading_days.date", start)
      .lte("trading_days.date", end)
      .is("deleted_at", null),
    loadDebriefStatuses(start, end),
    loadOpenActions(),
    supabase
      .from("action_items")
      .select("id, text, status")
      .neq("status", "open")
      .gte("closed_at", weekFrom)
      .lt("closed_at", weekTo)
      .is("deleted_at", null)
      .order("closed_at"),
    supabase
      .from("weekly_reviews")
      .select("reflection, goals, updated_at")
      .eq("iso_year", year)
      .eq("iso_week", week)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  for (const r of [violations, closed, review]) if (r.error) throw r.error;

  const violationsByDay: Record<string, number> = {};
  for (const v of violations.data ?? []) {
    const day = (Array.isArray(v.trading_days) ? v.trading_days[0] : v.trading_days) as {
      date: string;
    } | null;
    if (day) violationsByDay[day.date] = (violationsByDay[day.date] ?? 0) + 1;
  }

  return {
    year,
    week,
    key: isoWeekKey(year, week),
    start,
    end,
    prevKey: isoWeekKey(prev.year, prev.week),
    nextKey: isoWeekKey(next.year, next.week),
    trades,
    violationsByDay,
    debriefs: Object.fromEntries(statuses),
    openActions,
    closedThisWeek: closed.data ?? [],
    review: {
      reflection: review.data?.reflection ?? "",
      goals: review.data?.goals ?? [],
      updatedAt: review.data?.updated_at ?? null,
    },
  };
}

export type ReviewIndex = {
  days: { date: string; n: number; netR: number; rN: number; debrief: DebriefStatus }[];
  weeks: { key: string; start: string; n: number; netR: number; rN: number; reviewed: boolean }[];
};

/** Recent days (trades or debriefs, last 45 days) and the last 8 ISO weeks. */
export async function loadReviewIndex(today: IsoDate): Promise<ReviewIndex> {
  const from = addDays(today, -45);
  const firstWeekStart = addDays(isoWeekStart(isoWeekOf(today).year, isoWeekOf(today).week), -49);
  const supabase = await createClient();
  const [trades, statuses, reviews] = await Promise.all([
    loadTrades(firstWeekStart < from ? firstWeekStart : from, today),
    loadDebriefStatuses(from, today),
    supabase
      .from("weekly_reviews")
      .select("iso_year, iso_week, reflection, goals")
      .is("deleted_at", null)
      .order("iso_year", { ascending: false })
      .order("iso_week", { ascending: false })
      .limit(12),
  ]);
  if (reviews.error) throw reviews.error;

  const byDay = new Map<string, { n: number; netR: number; rN: number }>();
  for (const t of trades) {
    if (t.kind !== "taken" || t.trade_date < from) continue;
    const d = byDay.get(t.trade_date) ?? { n: 0, netR: 0, rN: 0 };
    d.n++;
    if (t.r_multiple !== null) {
      d.netR += t.r_multiple;
      d.rN++;
    }
    byDay.set(t.trade_date, d);
  }
  const dates = [...new Set([...byDay.keys(), ...statuses.keys()])].sort().reverse();

  const reviewed = new Set(
    (reviews.data ?? [])
      .filter((r) => (r.reflection ?? "").trim() || (r.goals ?? []).length)
      .map((r) => isoWeekKey(r.iso_year, r.iso_week)),
  );
  const weeks: ReviewIndex["weeks"] = [];
  for (let i = 0; i < 8; i++) {
    const start = addDays(firstWeekStart, (7 - i) * 7);
    const { year, week } = isoWeekOf(start);
    const end = addDays(start, 6);
    const list = trades.filter(
      (t) => t.kind === "taken" && t.trade_date >= start && t.trade_date <= end,
    );
    weeks.push({
      key: isoWeekKey(year, week),
      start,
      n: list.length,
      netR: Math.round(list.reduce((s, t) => s + (t.r_multiple ?? 0), 0) * 100) / 100,
      rN: list.filter((t) => t.r_multiple !== null).length,
      reviewed: reviewed.has(isoWeekKey(year, week)),
    });
  }

  return {
    days: dates.map((date) => ({
      date,
      ...(byDay.get(date) ?? { n: 0, netR: 0, rN: 0 }),
      netR: Math.round((byDay.get(date)?.netR ?? 0) * 100) / 100,
      debrief: statuses.get(date) ?? "none",
    })),
    weeks,
  };
}
