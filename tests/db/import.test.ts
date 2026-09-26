import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  E2E_USER,
  INTRUDER_USER,
  adminClient,
  anonClient,
  localSql,
  signedIn,
} from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let esId: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  const es = await me.client
    .from("instruments")
    .select("id")
    .eq("symbol", "ES")
    .is("deleted_at", null)
    .single();
  esId = es.data!.id;
});

function trade(hash = randomUUID(), fillHashes = [randomUUID(), randomUUID()]) {
  return {
    import_hash: hash,
    instrument_id: esId,
    direction: "long",
    entry_at: "2042-03-04T15:00:00Z",
    exit_at: "2042-03-04T15:05:00Z",
    entry_price: 5000,
    exit_price: 5002,
    contracts: 2,
    fees: 4.1,
    fills: [
      {
        hash: fillHashes[0],
        executed_at: "2042-03-04T15:00:00Z",
        account: "A1",
        symbol: "ESH2",
        side: "buy",
        price: 5000,
        qty: 2,
        raw: { Symbol: "ESH2" },
      },
      {
        hash: fillHashes[1],
        executed_at: "2042-03-04T15:05:00Z",
        account: "A1",
        symbol: "ESH2",
        side: "sell",
        price: 5002,
        qty: 2,
        raw: {},
      },
    ],
  };
}

describe("import_trades", () => {
  it("creates computed trades with fills, needing review; a re-import skips them", async () => {
    const t = trade();
    const first = await me.client.rpc("import_trades", { p_trades: [t] });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ created: 1, skipped: 0 });
    const id = (first.data as { trade_ids: string[] }).trade_ids[0];

    const row = await me.client
      .from("trades")
      .select("kind, needs_review, net_pnl, ticks, fees_total, import_hash")
      .eq("id", id)
      .single();
    // 2 points = 8 ticks × $12.50 × 2 contracts = $200, minus $4.10 fees
    expect(row.data).toMatchObject({
      kind: "taken",
      needs_review: true,
      ticks: 8,
      fees_total: 4.1,
      net_pnl: 195.9,
      import_hash: t.import_hash,
    });
    const fills = await me.client.from("fills").select("hash, trade_id").eq("trade_id", id);
    expect(fills.data).toHaveLength(2);

    const again = await me.client.rpc("import_trades", { p_trades: [t] });
    expect(again.data).toMatchObject({ created: 0, skipped: 1 });
    const count = await me.client
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("import_hash", t.import_hash);
    expect(count.count).toBe(1);
  });

  it("is all-or-nothing: a fill imported before aborts the whole batch", async () => {
    const first = trade();
    await me.client.rpc("import_trades", { p_trades: [first] });
    const fresh = trade();
    const clash = trade(randomUUID(), [first.fills[0].hash, randomUUID()]);
    const r = await me.client.rpc("import_trades", { p_trades: [fresh, clash] });
    expect(r.error?.code).toBe("23505");
    const written = await me.client
      .from("trades")
      .select("id")
      .in("import_hash", [fresh.import_hash, clash.import_hash]);
    expect(written.data).toHaveLength(0);
  });

  it("rejects malformed input and anonymous callers; fills stay private", async () => {
    const bad = await me.client.rpc("import_trades", { p_trades: { not: "array" } });
    expect(bad.error?.code).toBe("22023");
    const noFills = await me.client.rpc("import_trades", {
      p_trades: [{ ...trade(), fills: undefined }],
    });
    expect(noFills.error?.code).toBe("22023");
    const anon = await anonClient().rpc("import_trades", { p_trades: [trade()] });
    expect(anon.error).not.toBeNull();
    const theirs = await intruder.client.from("fills").select("id").eq("user_id", me.userId);
    expect(theirs.data).toHaveLength(0);
  });

  it("setting a domain clears needs_review", async () => {
    const r = await me.client.rpc("import_trades", { p_trades: [trade()] });
    const id = (r.data as { trade_ids: string[] }).trade_ids[0];
    await me.client.from("trades").update({ primary_domain: "TECHNICAL" }).eq("id", id);
    const row = await me.client.from("trades").select("needs_review").eq("id", id).single();
    expect(row.data?.needs_review).toBe(false);
  });
});

describe("purge_trash", () => {
  it("is service-role only and removes only rows deleted more than 30 days ago", async () => {
    const r = await me.client.rpc("import_trades", { p_trades: [trade(), trade()] });
    const [oldId, recentId] = (r.data as { trade_ids: string[] }).trade_ids;
    const media = await me.client
      .from("media")
      .insert({
        owner_type: "trade",
        owner_id: oldId,
        kind: "image",
        storage_path: `${me.userId}/trade/${oldId}/x.png`,
        thumb_path: `${me.userId}/trade/${oldId}/x-thumb.webp`,
      })
      .select("id")
      .single();
    expect(media.error).toBeNull();
    await sql`update public.trades set deleted_at = now() - interval '31 days' where id = ${oldId}`;
    await sql`update public.trades set deleted_at = now() - interval '5 days' where id = ${recentId}`;

    const denied = await me.client.rpc("purge_trash", { p_user: me.userId });
    expect(denied.error).not.toBeNull();

    const out = await adminClient().rpc("purge_trash", { p_user: me.userId });
    expect(out.error).toBeNull();
    const res = out.data as { media_paths: string[]; counts: Record<string, unknown> };
    expect(res.media_paths).toEqual(
      expect.arrayContaining([
        `${me.userId}/trade/${oldId}/x.png`,
        `${me.userId}/trade/${oldId}/x-thumb.webp`,
      ]),
    );
    const [gone] = await sql`select count(*)::int as n from public.trades where id = ${oldId}`;
    const [kept] = await sql`select count(*)::int as n from public.trades where id = ${recentId}`;
    const [fillsGone] =
      await sql`select count(*)::int as n from public.fills where trade_id = ${oldId}`;
    expect([gone.n, kept.n, fillsGone.n]).toEqual([0, 1, 0]);
  });
});

describe("backups bucket", () => {
  it("owners read and write only their own folder", async () => {
    const body = new Blob([JSON.stringify({ ok: true })], { type: "application/json" });
    const mine = await me.client.storage
      .from("backups")
      .upload(`${me.userId}/test-${Date.now()}.json`, body, { upsert: true });
    expect(mine.error).toBeNull();
    const foreign = await intruder.client.storage
      .from("backups")
      .upload(`${me.userId}/evil.json`, body);
    expect(foreign.error).not.toBeNull();
    const peek = await intruder.client.storage.from("backups").list(me.userId);
    expect(peek.data ?? []).toHaveLength(0);
  });
});
