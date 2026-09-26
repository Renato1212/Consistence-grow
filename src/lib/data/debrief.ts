import "server-only";

import { randomUUID } from "node:crypto";

import type { IsoDate } from "@/lib/calendar/dates";
import { loadMedia } from "@/lib/data/media";
import { formatLevelPrice, type PrepInstrument } from "@/lib/prep/prep-form";
import { debriefRowToSnapshot, type DebriefSnapshot } from "@/lib/review/debrief-form";
import type { FactTrade } from "@/lib/review/stats";
import { createClient } from "@/lib/supabase/server";
import type { PriceFormat } from "@/lib/trading/instrument-specs";
import type { MediaItem } from "@/components/trade/media-manager";
import { loadRules, type Rule } from "./prep";

export const FACT_COLUMNS =
  "id, kind, trade_date, entry_at, symbol, direction, net_pnl, r_multiple, currency, primary_domain, playbook_name, grade_process";

export type ActionItemRow = {
  id: string;
  text: string;
  source: string;
  showInPrep: boolean;
  createdAt: string;
};

export function toFact(r: Record<string, unknown>): FactTrade {
  return {
    id: r.id as string,
    kind: r.kind as FactTrade["kind"],
    trade_date: r.trade_date as string,
    entry_at: r.entry_at as string,
    symbol: (r.symbol as string) ?? "?",
    direction: r.direction as FactTrade["direction"],
    net_pnl: r.net_pnl === null ? null : Number(r.net_pnl),
    r_multiple: r.r_multiple === null ? null : Number(r.r_multiple),
    currency: (r.currency as string) ?? "USD",
    primary_domain: r.primary_domain as string | null,
    playbook_name: r.playbook_name as string | null,
    grade_process: r.grade_process as string | null,
  };
}

export async function loadDayTrades(date: IsoDate): Promise<FactTrade[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_facts")
    .select(FACT_COLUMNS)
    .eq("trade_date", date)
    .order("entry_at");
  if (error) throw error;
  return (data ?? []).map(toFact);
}

/** Open action items (all sources), oldest first. */
export async function loadOpenActions(
  opts: { inPrepOnly?: boolean } = {},
): Promise<ActionItemRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("action_items")
    .select("id, text, source, show_in_prep, created_at")
    .is("deleted_at", null)
    .eq("status", "open")
    .order("created_at");
  if (opts.inPrepOnly) q = q.eq("show_in_prep", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    text: a.text,
    source: a.source,
    showInPrep: a.show_in_prep,
    createdAt: a.created_at,
  }));
}

export type DebriefScenario = {
  id: string;
  session: string;
  symbol: string | null;
  direction: string | null;
  ifText: string;
  thenText: string;
  playbook: string | null;
};

export type DebriefLevel = {
  id: string;
  session: string;
  symbol: string;
  price: string;
  levelType: string;
  strength: number;
  note: string | null;
};

export type DebriefPageData = {
  date: IsoDate;
  newId: string;
  exists: boolean;
  updatedAt: string | null;
  snapshot: DebriefSnapshot;
  trades: FactTrade[];
  scenarios: DebriefScenario[];
  levels: DebriefLevel[];
  rules: Rule[];
  otherActions: ActionItemRow[];
  media: MediaItem[];
};

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadDebriefPage(date: IsoDate): Promise<DebriefPageData> {
  const supabase = await createClient();
  const [trades, rules, debrief, preps, checks] = await Promise.all([
    loadDayTrades(date),
    loadRules(),
    supabase
      .from("debriefs")
      .select(
        "id, updated_at, grade_context, grade_context_note, grade_edge, grade_edge_note, grade_process, grade_process_note, went_well, to_improve, lesson, mood, energy, completed_at, trading_days!inner(date)",
      )
      .eq("trading_days.date", date)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("session_preps")
      .select("id, session, trading_days!inner(date)")
      .eq("trading_days.date", date)
      .is("deleted_at", null),
    supabase
      .from("rule_checks")
      .select("rule_id, followed, note, trading_days!inner(date)")
      .eq("trading_days.date", date)
      .eq("context", "debrief")
      .is("deleted_at", null),
  ]);
  for (const r of [debrief, preps, checks]) if (r.error) throw r.error;

  const prepSession = new Map((preps.data ?? []).map((p) => [p.id, p.session]));
  const prepIds = [...prepSession.keys()];
  let scenarioRows: {
    id: string;
    prep_id: string;
    direction: string | null;
    if_text: string;
    then_text: string;
    outcome: string | null;
    traded: boolean | null;
    instruments: Embedded<{ symbol: string }>;
    playbooks: Embedded<{ name: string }>;
  }[] = [];
  let levelRows: {
    id: string;
    prep_id: string;
    price_low: number;
    price_high: number | null;
    level_type: string;
    strength: number;
    note: string | null;
    tested: boolean | null;
    respected: boolean | null;
    instruments: Embedded<{
      id: string;
      symbol: string;
      tick_size: number;
      price_format: string;
    }>;
  }[] = [];
  if (prepIds.length) {
    const [sc, lv] = await Promise.all([
      supabase
        .from("scenarios")
        .select(
          "id, prep_id, direction, if_text, then_text, outcome, traded, instruments(symbol), playbooks(name)",
        )
        .in("prep_id", prepIds)
        .is("deleted_at", null)
        .order("sort"),
      supabase
        .from("key_levels")
        .select(
          "id, prep_id, price_low, price_high, level_type, strength, note, tested, respected, instruments(id, symbol, tick_size, price_format)",
        )
        .in("prep_id", prepIds)
        .is("deleted_at", null)
        .order("strength", { ascending: false })
        .order("price_low", { ascending: false }),
    ]);
    if (sc.error) throw sc.error;
    if (lv.error) throw lv.error;
    scenarioRows = (sc.data ?? []) as unknown as typeof scenarioRows;
    levelRows = (lv.data ?? []) as unknown as typeof levelRows;
  }

  const row = debrief.data;
  const newId = randomUUID();
  const [actions, otherActions, media] = await Promise.all([
    row
      ? supabase
          .from("action_items")
          .select("id, text, show_in_prep, status")
          .eq("source", "debrief")
          .eq("source_id", row.id)
          .is("deleted_at", null)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    loadOpenActions(),
    row ? loadMedia("debrief", [row.id]) : Promise.resolve({} as Record<string, MediaItem[]>),
  ]);
  if (actions.error) throw actions.error;

  const snapshot = debriefRowToSnapshot(row, newId, date, {
    scenarios: scenarioRows.map((s) => ({ id: s.id, outcome: s.outcome, traded: s.traded })),
    levels: levelRows.map((l) => ({ id: l.id, tested: l.tested, respected: l.respected })),
    rules: (checks.data ?? []).map((c) => ({
      rule_id: c.rule_id,
      followed: c.followed,
      note: c.note,
    })),
    actions: actions.data ?? [],
  });
  const ownActionIds = new Set(snapshot.actions.map((a) => a.id));

  return {
    date,
    newId,
    exists: !!row,
    updatedAt: row?.updated_at ?? null,
    snapshot,
    trades,
    scenarios: scenarioRows.map((s) => ({
      id: s.id,
      session: prepSession.get(s.prep_id) ?? "",
      symbol: one(s.instruments)?.symbol ?? null,
      direction: s.direction,
      ifText: s.if_text,
      thenText: s.then_text,
      playbook: one(s.playbooks)?.name ?? null,
    })),
    levels: levelRows.map((l) => {
      const inst = one(l.instruments);
      const pi: PrepInstrument | undefined = inst
        ? {
            id: inst.id,
            symbol: inst.symbol,
            tickSize: Number(inst.tick_size),
            priceFormat: inst.price_format as PriceFormat,
          }
        : undefined;
      const low = formatLevelPrice(Number(l.price_low), pi);
      return {
        id: l.id,
        session: prepSession.get(l.prep_id) ?? "",
        symbol: inst?.symbol ?? "?",
        price: l.price_high === null ? low : `${low}–${formatLevelPrice(Number(l.price_high), pi)}`,
        levelType: l.level_type,
        strength: l.strength,
        note: l.note,
      };
    }),
    rules,
    otherActions: otherActions.filter((a) => !ownActionIds.has(a.id)),
    media: row ? (media[row.id] ?? []) : [],
  };
}

export type DebriefStatus = "none" | "draft" | "complete";

export async function loadDebriefStatuses(
  from: string,
  to: string,
): Promise<Map<string, DebriefStatus>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("debriefs")
    .select("completed_at, trading_days!inner(date)")
    .gte("trading_days.date", from)
    .lte("trading_days.date", to)
    .is("deleted_at", null);
  if (error) throw error;
  const out = new Map<string, DebriefStatus>();
  for (const d of data ?? []) {
    const day = (Array.isArray(d.trading_days) ? d.trading_days[0] : d.trading_days) as {
      date: string;
    } | null;
    if (day) out.set(day.date, d.completed_at ? "complete" : "draft");
  }
  return out;
}
