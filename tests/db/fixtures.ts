import type { SupabaseClient } from "@supabase/supabase-js";

/** Every user-owned table, with the primary-key column used to address rows. */
export const USER_TABLES = [
  "instruments",
  "user_settings",
  "trading_days",
  "playbooks",
  "playbook_versions",
  "playbook_checklist_items",
  "session_preps",
  "key_levels",
  "scenarios",
  "calendar_events",
  "trades",
  "fills",
  "tag_groups",
  "tags",
  "trade_tags",
  "media",
  "debriefs",
  "rules",
  "rule_checks",
  "action_items",
  "weekly_reviews",
  "saved_views",
  "ai_insights",
  "import_presets",
  "error_logs",
  "holidays",
  "calendar_templates",
] as const;

export type UserTable = (typeof USER_TABLES)[number];

type Row = { id: string; [key: string]: unknown };

async function one(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data as Row;
}

/**
 * Create at least one row in every user table for the signed-in user, so RLS
 * isolation tests exercise real rows. Uses a unique marker per run.
 */
export async function createRowInEveryTable(db: SupabaseClient, marker: string) {
  const es = await one(db.from("instruments").select("id").eq("symbol", "ES").single());
  const tag = await one(db.from("tags").select("id").limit(1).single());
  const rule = await one(db.from("rules").select("id").limit(1).single());
  const playbook = await one(db.from("playbooks").select("id").limit(1).single());

  // A unique future date per run keeps trading_days/debriefs unique.
  const offsetDays = Math.floor(Math.random() * 3000) + 100;
  const date = new Date(Date.UTC(2030, 0, 1) + offsetDays * 86400000);
  const entryAt = new Date(date.getTime() + 14 * 3600 * 1000).toISOString();

  const trade = await one(
    db
      .from("trades")
      .insert({
        instrument_id: es.id,
        direction: "long",
        entry_at: entryAt,
        entry_price: 5000,
        exit_price: 5001,
        contracts: 1,
        primary_domain: "TECHNICAL",
        thesis: marker,
      })
      .select("id, day_id")
      .single(),
  );
  const dayId = trade.day_id as string;

  const prep = await one(
    db.from("session_preps").insert({ day_id: dayId, session: "EU" }).select("id").single(),
  );
  const level = await one(
    db
      .from("key_levels")
      .insert({ prep_id: prep.id, instrument_id: es.id, price_low: 4990, level_type: "PDH" })
      .select("id")
      .single(),
  );
  await one(
    db
      .from("scenarios")
      .insert({ prep_id: prep.id, instrument_id: es.id, if_text: marker, then_text: "x" })
      .select("id")
      .single(),
  );
  await one(
    db
      .from("calendar_events")
      .insert({
        starts_at: entryAt,
        primary_domain: "DATA",
        category: "CPI",
        title: marker,
      })
      .select("id")
      .single(),
  );
  await one(
    db
      .from("fills")
      .insert({
        trade_id: trade.id,
        executed_at: entryAt,
        symbol: "ES",
        side: "buy",
        price: 5000,
        qty: 1,
        hash: `hash-${marker}`,
      })
      .select("id")
      .single(),
  );
  await one(db.from("trade_tags").insert({ trade_id: trade.id, tag_id: tag.id }).select().single());
  await one(
    db
      .from("media")
      .insert({ owner_type: "trade", owner_id: trade.id, kind: "link", url: "https://example.com" })
      .select("id")
      .single(),
  );
  await one(db.from("debriefs").insert({ day_id: dayId, lesson: marker }).select("id").single());
  await one(
    db
      .from("rule_checks")
      .insert({ rule_id: rule.id, day_id: dayId, context: "debrief", followed: true })
      .select("id")
      .single(),
  );
  await one(db.from("action_items").insert({ text: marker }).select("id").single());
  await one(
    db
      .from("weekly_reviews")
      .insert({ iso_year: 2030 + (offsetDays % 50), iso_week: (offsetDays % 52) + 1 })
      .select("id")
      .single(),
  );
  await one(db.from("saved_views").insert({ name: marker }).select("id").single());
  await one(
    db
      .from("ai_insights")
      .insert({ scope: "filter", data_hash: marker, model: "test", output: {} })
      .select("id")
      .single(),
  );
  await one(db.from("import_presets").insert({ name: marker }).select("id").single());
  await one(
    db
      .from("playbook_checklist_items")
      .insert({ playbook_id: playbook.id, text: marker })
      .select("id")
      .single(),
  );
  await one(
    db.from("error_logs").insert({ source: "test", message: marker }).select("id").single(),
  );

  return { tradeId: trade.id as string, dayId, levelId: level.id as string };
}
