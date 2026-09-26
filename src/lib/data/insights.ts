import "server-only";

import { normalizeFilter, type Filter } from "@/lib/insights/filters";
import type {
  InsightTrade,
  LevelFact,
  PlaybookRef,
  RuleCheckFact,
  ScenarioFact,
  TagInfo,
} from "@/lib/insights/types";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "./paginate";

const INSIGHT_COLUMNS =
  "id, kind, trade_date, entry_at, updated_at, symbol, currency, direction, net_pnl, r_multiple, ticks, duration_sec, session, weekday, time_bucket, primary_domain, secondary_domains, domain_count, playbook_id, playbook_name, playbook_version, minutes_from_event, event_category, event_title, level_type, level_strength, scenario_id, key_level_id, regime, prior_day_type, prep_done, readiness, confidence, grade_context, grade_edge, grade_process, exit_reason, tag_ids, tag_names";

/** Analytics are computed in the browser over at most this many trades. */
export const INSIGHT_LIMIT = 10000;

export type SavedView = { id: string; name: string; filter: Filter };

export type InsightsData = {
  trades: InsightTrade[];
  truncated: boolean;
  tags: TagInfo[];
  scenarios: ScenarioFact[];
  levels: LevelFact[];
  ruleChecks: RuleCheckFact[];
  playbooks: PlaybookRef[];
  views: SavedView[];
  patternMinN: number;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type Joined<T> = T | T[] | null;
const first = <T>(v: Joined<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadInsights(): Promise<InsightsData> {
  const supabase = await createClient();
  const [trades, tags, scenarios, levels, checks, playbooks, views, settings] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("trade_facts")
          .select(INSIGHT_COLUMNS)
          .order("entry_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      INSIGHT_LIMIT,
    ),
    supabase
      .from("tags")
      .select("id, name, tag_groups!inner(name, kind, deleted_at)")
      .is("deleted_at", null)
      .is("tag_groups.deleted_at", null),
    fetchAll(
      (from, to) =>
        supabase
          .from("scenarios")
          .select(
            "id, direction, primary_domain, outcome, traded, if_text, then_text, instruments(symbol), session_preps!inner(session, deleted_at, trading_days!inner(date))",
          )
          .is("deleted_at", null)
          .is("session_preps.deleted_at", null)
          .order("id")
          .range(from, to),
      INSIGHT_LIMIT,
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("key_levels")
          .select(
            "id, level_type, strength, tested, respected, instruments(symbol), session_preps!inner(deleted_at, trading_days!inner(date))",
          )
          .is("deleted_at", null)
          .is("session_preps.deleted_at", null)
          .order("id")
          .range(from, to),
      INSIGHT_LIMIT,
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("rule_checks")
          .select("id, followed, rules(text), trading_days!inner(date)")
          .eq("context", "debrief")
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      INSIGHT_LIMIT,
    ),
    supabase.from("playbooks").select("id, name, version").is("deleted_at", null).order("name"),
    supabase.from("saved_views").select("id, name, filter").is("deleted_at", null).order("name"),
    supabase.from("user_settings").select("pattern_min_n").maybeSingle(),
  ]);
  for (const r of [tags, playbooks, views, settings]) if (r.error) throw r.error;

  return {
    // Newest first from the database (so a cap keeps the recent ones), oldest first here.
    trades: [...trades.rows].reverse().map((r) => {
      const t = r as unknown as InsightTrade;
      return {
        ...t,
        net_pnl: num(t.net_pnl),
        r_multiple: num(t.r_multiple),
        ticks: num(t.ticks),
        readiness: num(t.readiness),
        secondary_domains: t.secondary_domains ?? [],
        tag_ids: t.tag_ids ?? [],
        tag_names: t.tag_names ?? [],
      };
    }),
    truncated: trades.truncated,
    tags: (tags.data ?? []).map((t) => {
      const g = first(t.tag_groups as Joined<{ name: string; kind: string }>);
      return { id: t.id, name: t.name, group: g?.name ?? "", kind: g?.kind ?? "custom" };
    }),
    scenarios: scenarios.rows.map((s) => {
      const prep = first(
        s.session_preps as Joined<{ session: string; trading_days: Joined<{ date: string }> }>,
      );
      return {
        id: s.id,
        date: first(prep?.trading_days ?? null)?.date ?? "",
        session: prep?.session ?? "",
        instrument: first(s.instruments as Joined<{ symbol: string }>)?.symbol ?? null,
        direction: s.direction,
        primary_domain: s.primary_domain,
        outcome: s.outcome as ScenarioFact["outcome"],
        traded: s.traded,
        text: [s.if_text, s.then_text].filter(Boolean).join(" → "),
      };
    }),
    levels: levels.rows.map((l) => {
      const prep = first(l.session_preps as Joined<{ trading_days: Joined<{ date: string }> }>);
      return {
        id: l.id,
        date: first(prep?.trading_days ?? null)?.date ?? "",
        instrument: first(l.instruments as Joined<{ symbol: string }>)?.symbol ?? "",
        level_type: l.level_type,
        strength: l.strength,
        tested: l.tested,
        respected: l.respected,
      };
    }),
    ruleChecks: checks.rows.map((c) => ({
      date: first(c.trading_days as Joined<{ date: string }>)?.date ?? "",
      rule: first(c.rules as Joined<{ text: string }>)?.text ?? "Rule",
      followed: c.followed,
    })),
    playbooks: (playbooks.data ?? []).map((p) => ({ id: p.id, name: p.name, version: p.version })),
    views: (views.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      filter: normalizeFilter(v.filter),
    })),
    patternMinN: settings.data?.pattern_min_n ?? 8,
  };
}
