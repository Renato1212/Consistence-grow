import "server-only";

import { randomUUID } from "node:crypto";

import { addDays, parseMonth, type IsoDate } from "@/lib/calendar/dates";
import { HolidayCalendar, type Holiday } from "@/lib/calendar/holidays";
import type { CalendarEvent } from "@/lib/calendar/types";
import { loadEditorData, type EditorInstrument, type EditorPlaybook } from "@/lib/data/editor";
import {
  prepRowToSnapshot,
  type LevelDraft,
  type LevelRow,
  type PrepRow,
  type PrepSnapshot,
  type ScenarioRow,
  type SessionCode,
  levelRowToDraft,
} from "@/lib/prep/prep-form";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_TZ, zonedWallTimeToUtc } from "@/lib/time";
import { loadEvents, loadHolidays, loadTemplates, syncGenerated } from "./calendar";

export const PREP_COLUMNS =
  "id, session, sleep, energy, focus, how_am_i, brief_md, prior_day_type, regime, vol_state, narrative, options_notes, focus_instrument_ids, focus_playbook_ids, intention, max_loss_usd, max_loss_r, max_trades, max_size, completed_at, copied_from_id, started_at, updated_at";
const LEVEL_COLUMNS =
  "id, prep_id, instrument_id, price_low, price_high, level_type, strength, note, carried_from_id, tested, sort";
const SCENARIO_COLUMNS =
  "id, prep_id, instrument_id, direction, if_text, then_text, playbook_id, primary_domain, sort";

export type LoadedPrep = {
  snapshot: PrepSnapshot;
  updatedAt: string;
  startedAt: string;
};

export type ActionItem = { id: string; text: string; dueDate: string | null };

export type Rule = { id: string; text: string; category: string };

/** Both session preps of a Lisbon date (with levels, scenarios, rule checks). */
export async function loadDayPreps(
  date: IsoDate,
  instruments: EditorInstrument[],
): Promise<Partial<Record<SessionCode, LoadedPrep>>> {
  const supabase = await createClient();
  const preps = await supabase
    .from("session_preps")
    .select(`${PREP_COLUMNS}, trading_days!inner(date)`)
    .eq("trading_days.date", date)
    .is("deleted_at", null);
  if (preps.error) throw preps.error;
  const rows = preps.data ?? [];
  if (rows.length === 0) return {};

  const ids = rows.map((r) => r.id);
  const [levels, scenarios, checks] = await Promise.all([
    supabase
      .from("key_levels")
      .select(LEVEL_COLUMNS)
      .in("prep_id", ids)
      .is("deleted_at", null)
      .order("sort"),
    supabase
      .from("scenarios")
      .select(SCENARIO_COLUMNS)
      .in("prep_id", ids)
      .is("deleted_at", null)
      .order("sort"),
    supabase
      .from("rule_checks")
      .select("prep_id, rule_id, followed")
      .in("prep_id", ids)
      .is("deleted_at", null),
  ]);
  for (const r of [levels, scenarios, checks]) if (r.error) throw r.error;

  const out: Partial<Record<SessionCode, LoadedPrep>> = {};
  for (const row of rows) {
    const session = row.session as SessionCode;
    out[session] = {
      snapshot: prepRowToSnapshot(
        row as unknown as PrepRow,
        date,
        session,
        (levels.data ?? []).filter((l) => l.prep_id === row.id) as unknown as LevelRow[],
        (scenarios.data ?? []).filter((s) => s.prep_id === row.id) as ScenarioRow[],
        (checks.data ?? []).filter((c) => c.prep_id === row.id),
        instruments,
      ),
      updatedAt: row.updated_at,
      startedAt: row.started_at,
    };
  }
  return out;
}

/** Untested levels of the most recent earlier day with a prep (US preferred). */
async function loadPreviousLevels(
  date: IsoDate,
  instruments: EditorInstrument[],
): Promise<{ date: string; levels: LevelDraft[]; tested: Record<string, boolean | null> } | null> {
  const supabase = await createClient();
  const days = await supabase
    .from("trading_days")
    .select("id, date, session_preps!inner(id, session)")
    .lt("date", date)
    .is("session_preps.deleted_at", null)
    .order("date", { ascending: false })
    .limit(1);
  if (days.error) throw days.error;
  const day = days.data?.[0];
  if (!day) return null;
  const preps = day.session_preps as { id: string; session: string }[];
  const prep = preps.find((p) => p.session === "US") ?? preps[0];
  const levels = await supabase
    .from("key_levels")
    .select(LEVEL_COLUMNS)
    .eq("prep_id", prep.id)
    .is("deleted_at", null)
    .order("sort");
  if (levels.error) throw levels.error;
  const rows = (levels.data ?? []) as unknown as LevelRow[];
  return {
    date: day.date,
    levels: rows.map((l) => levelRowToDraft(l, instruments)),
    tested: Object.fromEntries(rows.map((l) => [l.id, l.tested])),
  };
}

export async function loadRules(): Promise<Rule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .select("id, text, category")
    .is("deleted_at", null)
    .eq("active", true)
    .order("sort");
  if (error) throw error;
  return data ?? [];
}

export async function loadPrepActionItems(): Promise<ActionItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("action_items")
    .select("id, text, due_date")
    .is("deleted_at", null)
    .eq("status", "open")
    .eq("show_in_prep", true)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((a) => ({ id: a.id, text: a.text, dueDate: a.due_date }));
}

/** Calendar events of a Lisbon date (generated rows synced for its month first). */
export async function loadDayEvents(date: IsoDate, cal: HolidayCalendar): Promise<CalendarEvent[]> {
  const { year, month } = parseMonth(date);
  await syncGenerated(year, month, 1, cal, await loadTemplates());
  return loadEvents(
    zonedWallTimeToUtc(`${date} 00:00`, DISPLAY_TZ).toISOString(),
    zonedWallTimeToUtc(`${addDays(date, 1)} 00:00`, DISPLAY_TZ).toISOString(),
  );
}

export type PrepPageData = {
  date: IsoDate;
  session: SessionCode;
  newId: string;
  current: LoadedPrep | null;
  eu: PrepSnapshot | null;
  previous: Awaited<ReturnType<typeof loadPreviousLevels>>;
  instruments: EditorInstrument[];
  playbooks: EditorPlaybook[];
  rules: Rule[];
  events: CalendarEvent[];
  holidays: Holiday[];
  actionItems: ActionItem[];
};

export async function loadPrepPage(date: IsoDate, session: SessionCode): Promise<PrepPageData> {
  const [editor, holidays, rules, actionItems] = await Promise.all([
    loadEditorData(),
    loadHolidays(),
    loadRules(),
    loadPrepActionItems(),
  ]);
  const cal = new HolidayCalendar(holidays);
  const [preps, previous, events] = await Promise.all([
    loadDayPreps(date, editor.instruments),
    loadPreviousLevels(date, editor.instruments),
    loadDayEvents(date, cal),
  ]);
  return {
    date,
    session,
    newId: randomUUID(),
    current: preps[session] ?? null,
    eu: session === "US" ? (preps.EU?.snapshot ?? null) : null,
    previous,
    instruments: editor.instruments,
    playbooks: editor.playbooks,
    rules,
    events,
    holidays,
    actionItems,
  };
}
