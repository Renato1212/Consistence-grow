import "server-only";

import { defaultRoutine, parseRoutine, SETUP_NAMES, type Routine } from "@/lib/routine/routine";
import type { GuardTrade } from "@/lib/routine/schedule";
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
