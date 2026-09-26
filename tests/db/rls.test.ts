import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { E2E_USER, INTRUDER_USER, anonClient, signedIn } from "../local-supabase";
import { USER_TABLES, createRowInEveryTable } from "./fixtures";

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let fixture: Awaited<ReturnType<typeof createRowInEveryTable>>;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  fixture = await createRowInEveryTable(me.client, `rls-${Date.now()}`);
});

describe("RLS isolation on every user table", () => {
  it.each(USER_TABLES)("%s: I can read my own rows", async (table) => {
    const { data, error } = await me.client.from(table).select("user_id").limit(50);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((r) => r.user_id === me.userId)).toBe(true);
  });

  it.each(USER_TABLES)("%s: a second user never sees my rows", async (table) => {
    const { data, error } = await intruder.client
      .from(table)
      .select("user_id")
      .eq("user_id", me.userId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it.each(USER_TABLES)("%s: anonymous clients see nothing", async (table) => {
    const { data } = await anonClient().from(table).select("user_id").limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it("a second user cannot insert rows into my account", async () => {
    const { error } = await intruder.client
      .from("rules")
      .insert({ user_id: me.userId, text: "planted rule" });
    expect(error).not.toBeNull();
  });

  it("a second user cannot update or delete my rows", async () => {
    const mine = await me.client.from("rules").select("id, text").limit(1).single();
    expect(mine.error).toBeNull();
    const id = mine.data!.id as string;

    const upd = await intruder.client
      .from("rules")
      .update({ text: "hacked" })
      .eq("id", id)
      .select();
    expect(upd.data ?? []).toHaveLength(0);
    const del = await intruder.client.from("rules").delete().eq("id", id).select();
    expect(del.data ?? []).toHaveLength(0);

    const after = await me.client.from("rules").select("text").eq("id", id).single();
    expect(after.data!.text).toBe(mine.data!.text);
  });

  it("the trade_facts view respects RLS", async () => {
    const mine = await me.client
      .from("trade_facts")
      .select("id, user_id, tag_names")
      .eq("id", fixture.tradeId)
      .single();
    expect(mine.error).toBeNull();
    expect((mine.data!.tag_names as string[]).length).toBe(1);

    const theirs = await intruder.client.from("trade_facts").select("id").eq("user_id", me.userId);
    expect(theirs.data).toHaveLength(0);
  });

  it("a trade cannot reference another user's instrument", async () => {
    const myEs = await me.client.from("instruments").select("id").eq("symbol", "ES").single();
    const { error } = await intruder.client.from("trades").insert({
      instrument_id: myEs.data!.id,
      direction: "long",
      entry_at: new Date().toISOString(),
      entry_price: 1,
      contracts: 1,
    });
    expect(error).not.toBeNull();
  });
});
