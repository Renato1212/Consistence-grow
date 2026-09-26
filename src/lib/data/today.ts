import "server-only";

import { HolidayCalendar } from "@/lib/calendar/holidays";
import { loadEditorData } from "@/lib/data/editor";
import { createClient } from "@/lib/supabase/server";
import { todayState, type TodayState } from "@/lib/today/state";
import { loadHolidays, loadSettings } from "./calendar";
import { loadDayEvents, loadDayPreps, loadPrepActionItems, loadRules } from "./prep";

export type DayResult = {
  n: number;
  netR: number;
  rN: number;
  byCurrency: Record<string, number>;
  losses: number; // taken trades with net < 0
};

async function loadDayResult(date: string): Promise<DayResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select("net_pnl, r_multiple, currency")
    .eq("trade_date", date)
    .eq("kind", "taken")
    .is("deleted_at", null);
  if (error) throw error;
  const out: DayResult = { n: 0, netR: 0, rN: 0, byCurrency: {}, losses: 0 };
  for (const t of data ?? []) {
    out.n++;
    if (t.net_pnl !== null) {
      const cur = t.currency ?? "USD";
      out.byCurrency[cur] = (out.byCurrency[cur] ?? 0) + Number(t.net_pnl);
      if (Number(t.net_pnl) < 0) out.losses++;
    }
    if (t.r_multiple !== null) {
      out.netR += Number(t.r_multiple);
      out.rN++;
    }
  }
  return out;
}

export async function loadToday(now: Date) {
  const [settings, holidays, editor, rules, actionItems] = await Promise.all([
    loadSettings(),
    loadHolidays(),
    loadEditorData(),
    loadRules(),
    loadPrepActionItems(),
  ]);
  const cal = new HolidayCalendar(holidays);
  const state: TodayState = todayState(now, cal, settings);
  const [preps, events, result] = await Promise.all([
    loadDayPreps(state.date, editor.instruments),
    loadDayEvents(state.date, cal),
    loadDayResult(state.date),
  ]);
  return {
    state,
    settings,
    holidays,
    instruments: editor.instruments,
    playbooks: editor.playbooks,
    rules,
    actionItems,
    preps,
    events,
    result,
  };
}

export type TodayData = Awaited<ReturnType<typeof loadToday>>;
