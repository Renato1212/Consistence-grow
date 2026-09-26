import "server-only";

import { createClient } from "@/lib/supabase/server";

export const JOURNAL_COLUMNS =
  "id, kind, symbol, currency, direction, entry_at, exit_at, entry_price, exit_price, stop_price, target_price, contracts, ticks, gross_pnl, fees_total, net_pnl, r_multiple, no_stop, duration_sec, session, time_bucket, trade_date, primary_domain, secondary_domains, playbook_name, grade_context, grade_edge, grade_process, grade_context_reason, grade_edge_reason, grade_process_reason, confidence, entry_type, exit_reason, tag_names, media_count, thesis, management, lesson, move_trigger, move_phases, needs_review, mae_ticks, mfe_ticks, instrument_id, checklist";

export type JournalTrade = {
  id: string;
  kind: "taken" | "missed" | "observed";
  symbol: string;
  currency: string;
  direction: "long" | "short";
  entry_at: string;
  exit_at: string | null;
  entry_price: number;
  exit_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  contracts: number | null;
  ticks: number | null;
  gross_pnl: number | null;
  fees_total: number | null;
  net_pnl: number | null;
  r_multiple: number | null;
  no_stop: boolean;
  duration_sec: number | null;
  session: string | null;
  time_bucket: string | null;
  trade_date: string | null;
  primary_domain: string | null;
  secondary_domains: string[];
  playbook_name: string | null;
  grade_context: string | null;
  grade_edge: string | null;
  grade_process: string | null;
  grade_context_reason: string | null;
  grade_edge_reason: string | null;
  grade_process_reason: string | null;
  confidence: number | null;
  entry_type: string | null;
  exit_reason: string | null;
  tag_names: string[];
  media_count: number;
  thesis: string | null;
  management: string | null;
  lesson: string | null;
  move_trigger: string | null;
  move_phases: string | null;
  checklist: Record<string, boolean> | null;
  needs_review: boolean;
  mae_ticks: number | null;
  mfe_ticks: number | null;
  instrument_id: string;
};

const LIMIT = 2000;

/** Live trades, newest first (RLS scopes to the user). */
export async function loadJournal(): Promise<{ trades: JournalTrade[]; truncated: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select(JOURNAL_COLUMNS)
    .order("entry_at", { ascending: false })
    .limit(LIMIT + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as JournalTrade[];
  return { trades: rows.slice(0, LIMIT), truncated: rows.length > LIMIT };
}

export async function loadJournalTrade(id: string): Promise<JournalTrade | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select(JOURNAL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as JournalTrade) ?? null;
}

export type TrashedTrade = {
  id: string;
  deleted_at: string;
  entry_at: string;
  kind: string;
  direction: string;
  net_pnl: number | null;
  r_multiple: number | null;
  symbol: string;
  currency: string;
  daysLeft: number;
};

/** Trades deleted in the last 30 days (older ones are purged by the backup job). */
export async function loadTrash(): Promise<TrashedTrade[]> {
  const supabase = await createClient();
  const now = Date.now();
  const since = new Date(now - 30 * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("trades")
    .select(
      "id, deleted_at, entry_at, kind, direction, net_pnl, r_multiple, instruments(symbol, currency)",
    )
    .not("deleted_at", "is", null)
    .gte("deleted_at", since)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => {
    const inst = t.instruments as unknown as { symbol: string; currency: string } | null;
    return {
      id: t.id,
      deleted_at: t.deleted_at as string,
      entry_at: t.entry_at,
      kind: t.kind,
      direction: t.direction,
      net_pnl: t.net_pnl,
      r_multiple: t.r_multiple,
      symbol: inst?.symbol ?? "?",
      currency: inst?.currency ?? "USD",
      daysLeft: Math.max(
        0,
        30 - Math.floor((now - Date.parse(t.deleted_at as string)) / 86400_000),
      ),
    };
  });
}
