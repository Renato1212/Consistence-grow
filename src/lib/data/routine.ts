import "server-only";

import {
  defaultRoutine,
  parseRoutine,
  SETUP_NAMES,
  setupPlaybookIds,
  type Routine,
} from "@/lib/routine/routine";
import { loadHolidayCalendar } from "@/lib/data/calendar";
import { fetchAll } from "@/lib/data/paginate";
import { blocksForDay, type BlockInstance, type GuardTrade } from "@/lib/routine/schedule";
import {
  adherence,
  parseSetupNotes,
  setupStats,
  type Adherence,
  type SetupNote,
  type SetupStats,
} from "@/lib/routine/scorecard";
import { createClient } from "@/lib/supabase/server";

export type SetupKey = keyof typeof SETUP_NAMES;
export type Setup = { key: SetupKey | null; id: string; name: string; status: string };

const SETUP_KEYS = Object.keys(SETUP_NAMES) as SetupKey[];

/** The routine's setup playbooks, found by their seed marker, else by their default name. */
export async function loadSetups(): Promise<Partial<Record<SetupKey, Setup>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playbooks")
    .select("id, name, status, notes_json, created_at")
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  const out: Partial<Record<SetupKey, Setup>> = {};
  for (const p of data ?? []) {
    const marker = (p.notes_json as { routine_setup?: string } | null)?.routine_setup;
    const key = SETUP_KEYS.find((k) => k === marker);
    if (key && !out[key]) out[key] = { key, id: p.id, name: p.name, status: p.status };
  }
  for (const k of SETUP_KEYS) {
    if (out[k]) continue;
    const p = (data ?? []).find((x) => x.name === SETUP_NAMES[k]);
    if (p) out[k] = { key: k, id: p.id, name: p.name, status: p.status };
  }
  return out;
}

export type LoadedRoutine = {
  routine: Routine;
  /** False when the default is shown (nothing saved yet, or the saved one is invalid). */
  stored: boolean;
  setups: Partial<Record<SetupKey, Setup>>;
};

/** The saved routine, else the default linked to the seeded setups. */
export async function loadRoutine(): Promise<LoadedRoutine> {
  const supabase = await createClient();
  const [settings, setups] = await Promise.all([
    supabase.from("user_settings").select("routine").maybeSingle(),
    loadSetups(),
  ]);
  if (settings.error) throw settings.error;
  const fallback = defaultRoutine(
    Object.fromEntries(Object.entries(setups).map(([k, s]) => [k, s.id])),
  );
  const raw = settings.data?.routine ?? null;
  const routine = raw === null ? fallback : parseRoutine(raw, fallback);
  return { routine, stored: raw !== null && routine !== fallback, setups };
}

export type RoutineDayRow = {
  checks: Record<string, boolean>;
  bias: Record<string, string | boolean>;
  noTrade: boolean;
  followed: "yes" | "partly" | "no" | null;
  lesson: string | null;
};

export async function loadRoutineDay(date: string): Promise<Record<string, RoutineDayRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routine_days")
    .select("block_key, checks, bias, no_trade, followed, lesson")
    .eq("date", date)
    .is("deleted_at", null);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((r) => [
      r.block_key,
      {
        checks: (r.checks ?? {}) as RoutineDayRow["checks"],
        bias: (r.bias ?? {}) as RoutineDayRow["bias"],
        noTrade: r.no_trade,
        followed: r.followed as RoutineDayRow["followed"],
        lesson: r.lesson,
      },
    ]),
  );
}

/** Taken trades of a trading day, in the shape the guardrails need. */
export async function loadGuardTrades(
  date: string,
): Promise<(GuardTrade & { rMultiple: number | null })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select("id, playbook_id, entry_at, time_estimated, net_pnl, r_multiple")
    .eq("trade_date", date)
    .eq("kind", "taken")
    .is("deleted_at", null)
    .order("entry_at");
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id!,
    playbookId: t.playbook_id,
    entryAt: t.entry_at!,
    timeEstimated: t.time_estimated ?? false,
    net: t.net_pnl === null ? null : Number(t.net_pnl),
    rMultiple: t.r_multiple === null ? null : Number(t.r_multiple),
  }));
}

export type QuickPrep = {
  narrative: string;
  instrumentIds: string[];
  bias: Record<string, "long" | "short" | "neutral">;
  completed: boolean;
};

export async function loadQuickPreps(
  date: string,
): Promise<Partial<Record<"EU" | "US", QuickPrep>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("session_preps")
    .select(
      "session, narrative, focus_instrument_ids, instrument_bias, completed_at, day:trading_days!inner(date)",
    )
    .eq("day.date", date)
    .is("deleted_at", null);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((p) => [
      p.session,
      {
        narrative: p.narrative ?? "",
        instrumentIds: p.focus_instrument_ids ?? [],
        bias: (p.instrument_bias ?? {}) as QuickPrep["bias"],
        completed: p.completed_at !== null,
      },
    ]),
  );
}

export type QuickDebriefData = {
  date: string;
  blocks: BlockInstance[];
  days: Record<string, RoutineDayRow>;
  trades: (GuardTrade & { rMultiple: number | null })[];
  setups: Record<string, string>;
  grade: "A" | "B" | "C" | "F" | null;
  lesson: string;
  completed: boolean;
  /** The full debrief has content beyond the quick one (other grades, notes…). */
  hasFull: boolean;
};

export async function loadQuickDebrief(date: string): Promise<QuickDebriefData> {
  const supabase = await createClient();
  const [{ routine }, cal, days, trades, debrief, pbs] = await Promise.all([
    loadRoutine(),
    loadHolidayCalendar(),
    loadRoutineDay(date),
    loadGuardTrades(date),
    supabase
      .from("debriefs")
      .select(
        "grade_context, grade_edge, grade_process, lesson, went_well, to_improve, completed_at, trading_days!inner(date)",
      )
      .eq("trading_days.date", date)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("playbooks").select("id, name").is("deleted_at", null),
  ]);
  if (debrief.error) throw debrief.error;
  if (pbs.error) throw pbs.error;
  const d = debrief.data;
  return {
    date,
    blocks: blocksForDay(routine, date, cal).filter((b) => b.kind === "trade"),
    days,
    trades,
    setups: Object.fromEntries((pbs.data ?? []).map((p) => [p.id, p.name])),
    grade: (d?.grade_process ?? null) as QuickDebriefData["grade"],
    lesson: d?.lesson ?? "",
    completed: !!d?.completed_at,
    hasFull:
      !!d &&
      (d.grade_context !== null ||
        d.grade_edge !== null ||
        (d.went_well ?? []).length > 0 ||
        (d.to_improve ?? []).length > 0),
  };
}

export type SetupScore = {
  playbookId: string;
  name: string;
  status: string;
  week: SetupStats;
  allTime: SetupStats;
  adherence: Adherence;
  note: SetupNote;
};

/** Scorecard rows for the routine's setups over an ISO week. */
export async function loadSetupScorecard(
  year: number,
  week: number,
  start: string,
  end: string,
): Promise<SetupScore[]> {
  const supabase = await createClient();
  const { routine } = await loadRoutine();
  const ids = setupPlaybookIds(routine);
  if (ids.length === 0) return [];
  const [pbs, trades, days, review] = await Promise.all([
    supabase.from("playbooks").select("id, name, status").in("id", ids).is("deleted_at", null),
    fetchAll<{
      playbook_id: string | null;
      trade_date: string | null;
      net_pnl: number | null;
      r_multiple: number | null;
    }>(
      (from, to) =>
        supabase
          .from("trade_facts")
          .select("playbook_id, trade_date, net_pnl, r_multiple")
          .in("playbook_id", ids)
          .eq("kind", "taken")
          .is("deleted_at", null)
          .order("entry_at")
          .order("id")
          .range(from, to),
      50_000,
    ),
    supabase
      .from("routine_days")
      .select("block_key, followed")
      .gte("date", start)
      .lte("date", end)
      .is("deleted_at", null),
    supabase
      .from("weekly_reviews")
      .select("setup_notes")
      .eq("iso_year", year)
      .eq("iso_week", week)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  for (const r of [pbs, days, review]) if (r.error) throw r.error;
  const notes = parseSetupNotes(review.data?.setup_notes);
  const rows = trades.rows.map((t) => ({
    playbookId: t.playbook_id,
    tradeDate: t.trade_date ?? "",
    net: t.net_pnl === null ? null : Number(t.net_pnl),
    r: t.r_multiple === null ? null : Number(t.r_multiple),
  }));
  const out: SetupScore[] = [];
  for (const id of ids) {
    const pb = (pbs.data ?? []).find((p) => p.id === id);
    if (!pb) continue;
    const mine = rows.filter((t) => t.playbookId === id);
    const blockKeys = new Set(routine.blocks.filter((b) => b.playbookId === id).map((b) => b.key));
    out.push({
      playbookId: id,
      name: pb.name,
      status: pb.status,
      week: setupStats(mine.filter((t) => t.tradeDate >= start && t.tradeDate <= end)),
      allTime: setupStats(mine),
      adherence: adherence(
        (days.data ?? [])
          .filter((d) => blockKeys.has(d.block_key))
          .map((d) => d.followed as "yes" | "partly" | "no" | null),
      ),
      note: notes[id] ?? { verdict: null, note: "" },
    });
  }
  return out;
}

/** The routine's setups in block order, for one-tap setup chips. */
export async function loadSetupOptions(): Promise<{ id: string; name: string }[]> {
  const { routine } = await loadRoutine();
  const ids = setupPlaybookIds(routine);
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playbooks")
    .select("id, name")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return ids.flatMap((id) => (data ?? []).filter((p) => p.id === id));
}
