import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_HOLIDAYS } from "@/lib/calendar/holidays";
import { E2E_USER, INTRUDER_USER, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let esId: string;
let ruleId: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  esId = (await me.client.from("instruments").select("id").eq("symbol", "ES").single()).data!.id;
  ruleId = (await me.client.from("rules").select("id").limit(1).single()).data!.id;
});

/** A unique far-future date per run so preps never collide across runs. */
function uniqueDate() {
  const d = new Date(Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 5000) * 86400000);
  return d.toISOString().slice(0, 10);
}

describe("phase 3 defaults", () => {
  it("seeds holidays identical to the TS list and four inactive templates", async () => {
    const rows = await sql`
      select market, to_char(date, 'YYYY-MM-DD') as date, name, to_char(early_close, 'HH24:MI') as early_close
        from public.holidays where user_id = ${me.userId} and deleted_at is null
       order by market, date`;
    const expected = [...DEFAULT_HOLIDAYS]
      .sort((a, b) => a.market.localeCompare(b.market) || a.date.localeCompare(b.date))
      .map((h) => ({ market: h.market, date: h.date, name: h.name, early_close: h.earlyClose }));
    expect(rows.map((r) => ({ ...r }))).toEqual(expected);

    const tpl = await sql`
      select preset_key, active from public.calendar_templates where user_id = ${me.userId}`;
    expect(tpl.map((t) => t.preset_key).sort()).toEqual(["api", "claims", "eia", "natgas"]);
  });

  it("phase-3 seeding is idempotent", async () => {
    const count = async () =>
      (await sql`select count(*)::int as n from public.holidays where user_id = ${me.userId}`)[0].n;
    const before = await count();
    await sql`select private.seed_phase3_defaults(${me.userId}::uuid)`;
    expect(await count()).toBe(before);
  });
});

describe("ensure_trading_day", () => {
  it("is idempotent and per user", async () => {
    const date = uniqueDate();
    const a = await me.client.rpc("ensure_trading_day", { p_date: date });
    const b = await me.client.rpc("ensure_trading_day", { p_date: date });
    expect(a.error).toBeNull();
    expect(a.data).toBe(b.data);
    const theirs = await intruder.client.rpc("ensure_trading_day", { p_date: date });
    expect(theirs.data).not.toBe(a.data);
  });
});

describe("save_prep", () => {
  it("saves prep, levels, scenarios and rule checks in one call; removed rows are soft-deleted", async () => {
    const date = uniqueDate();
    const prepId = randomUUID();
    const l1 = randomUUID();
    const l2 = randomUUID();
    const sc = randomUUID();
    const snapshot = {
      id: prepId,
      date,
      session: "EU",
      sleep: 4,
      energy: 3,
      focus: 5,
      how_am_i: "calm",
      narrative: "CPI tomorrow",
      focus_instrument_ids: [esId],
      max_loss_usd: 500,
      levels: [
        { id: l1, instrument_id: esId, price_low: 5000, level_type: "PDH", strength: 3 },
        {
          id: l2,
          instrument_id: esId,
          price_low: 4980,
          price_high: 4985,
          level_type: "Beginning zone",
          strength: 1,
        },
      ],
      scenarios: [{ id: sc, instrument_id: esId, direction: "long", if_text: "a", then_text: "b" }],
      rule_checks: [{ rule_id: ruleId, followed: true }],
    };
    const first = await me.client.rpc("save_prep", { p: snapshot });
    expect(first.error).toBeNull();
    expect(first.data).toBe(prepId);
    // Idempotent retry of the same snapshot
    expect((await me.client.rpc("save_prep", { p: snapshot })).error).toBeNull();

    const levels = await me.client
      .from("key_levels")
      .select("id, sort, strength, price_high")
      .eq("prep_id", prepId)
      .is("deleted_at", null)
      .order("sort");
    expect(levels.data!.map((l) => l.id)).toEqual([l1, l2]);

    // Remove one level, reorder nothing else, change a field
    const second = await me.client.rpc("save_prep", {
      p: { ...snapshot, sleep: 2, levels: [snapshot.levels[1]], rule_checks: [] },
    });
    expect(second.error).toBeNull();
    const after = await sql`
      select id, deleted_at is not null as deleted from public.key_levels where prep_id = ${prepId} order by sort`;
    expect(after.find((r) => r.id === l1)!.deleted).toBe(true);
    expect(after.find((r) => r.id === l2)!.deleted).toBe(false);

    const [prep] = await sql`
      select p.sleep, p.narrative, d.date::text as date, p.session,
             (select count(*)::int from public.rule_checks rc where rc.prep_id = p.id) as checks
        from public.session_preps p join public.trading_days d on d.id = p.day_id
       where p.id = ${prepId}`;
    expect(prep).toMatchObject({
      sleep: 2,
      narrative: "CPI tomorrow",
      date,
      session: "EU",
      checks: 1,
    });
  });

  it("another user cannot overwrite my prep", async () => {
    const date = uniqueDate();
    const id = randomUUID();
    expect(
      (await me.client.rpc("save_prep", { p: { id, date, session: "US", narrative: "mine" } }))
        .error,
    ).toBeNull();
    const hijack = await intruder.client.rpc("save_prep", {
      p: { id, date, session: "US", narrative: "hacked" },
    });
    expect(hijack.error).not.toBeNull();
    const [row] = await sql`select narrative from public.session_preps where id = ${id}`;
    expect(row.narrative).toBe("mine");
  });

  it("rejects incomplete payloads", async () => {
    const { error } = await me.client.rpc("save_prep", { p: { id: randomUUID() } });
    expect(error).not.toBeNull();
  });
});

describe("sync_generated_events", () => {
  const from = "2045-01-01T00:00:00Z";
  const to = "2045-03-01T00:00:00Z";
  const ev = (key: string, startsAt: string, title = "Monthly OPEX") => ({
    generator_key: key,
    starts_at: startsAt,
    native_tz: "America/New_York",
    primary_domain: "FLOW",
    category: "Options expiration",
    title,
    importance: 2,
    instruments: ["ES"],
    notes: null,
    source: "generated",
  });

  it("upserts by key, keeps user edits, removes rows no longer generated", async () => {
    const events = [
      ev("test-opex:2045-01", "2045-01-20T14:30:00Z"),
      ev("test-opex:2045-02", "2045-02-17T14:30:00Z"),
    ];
    const first = await me.client.rpc("sync_generated_events", {
      p_from: from,
      p_to: to,
      p_events: events,
    });
    expect(first.error).toBeNull();
    // Same payload again: nothing to change
    const again = await me.client.rpc("sync_generated_events", {
      p_from: from,
      p_to: to,
      p_events: events,
    });
    expect(again.data).toBe(0);

    // User edits notes/importance on one row
    await me.client
      .from("calendar_events")
      .update({ notes: "watch it", importance: 3 })
      .eq("generator_key", "test-opex:2045-01");

    // Holiday moved the date: row moves, edits survive; Feb dropped → removed
    await me.client.rpc("sync_generated_events", {
      p_from: from,
      p_to: to,
      p_events: [ev("test-opex:2045-01", "2045-01-19T14:30:00Z")],
    });
    const rows = await me.client
      .from("calendar_events")
      .select("generator_key, starts_at, notes, importance")
      .like("generator_key", "test-opex:%");
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0]).toMatchObject({ notes: "watch it", importance: 3 });
    expect(new Date(rows.data![0].starts_at).toISOString()).toBe("2045-01-19T14:30:00.000Z");
  });

  it("never touches another user's rows", async () => {
    await me.client.rpc("sync_generated_events", {
      p_from: from,
      p_to: to,
      p_events: [ev("test-iso:2045-01", "2045-01-19T14:30:00Z")],
    });
    await intruder.client.rpc("sync_generated_events", { p_from: from, p_to: to, p_events: [] });
    const mine = await me.client
      .from("calendar_events")
      .select("id")
      .eq("generator_key", "test-iso:2045-01");
    expect(mine.data).toHaveLength(1);
  });
});
