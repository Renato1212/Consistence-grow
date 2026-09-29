import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { E2E_USER, INTRUDER_USER, anonClient, signedIn } from "../local-supabase";

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let groupId: string;
let esId: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  const g = await me.client
    .from("tag_groups")
    .insert({ name: `Merge test ${Date.now()}`, kind: "custom" })
    .select("id")
    .single();
  groupId = g.data!.id;
  const es = await me.client
    .from("instruments")
    .select("id")
    .eq("symbol", "ES")
    .is("deleted_at", null)
    .single();
  esId = es.data!.id;
});

async function tag(name: string) {
  const r = await me.client
    .from("tags")
    .insert({ name: `${name} ${Math.random().toString(36).slice(2, 7)}`, group_id: groupId })
    .select("id")
    .single();
  return r.data!.id as string;
}

async function trade(tagIds: string[]) {
  const r = await me.client
    .from("trades")
    .insert({
      instrument_id: esId,
      direction: "long",
      entry_at: "2043-02-03T15:00:00Z",
      exit_at: "2043-02-03T15:05:00Z",
      entry_price: 5000,
      exit_price: 5001,
      contracts: 1,
    })
    .select("id")
    .single();
  const id = r.data!.id as string;
  if (tagIds.length)
    await me.client.from("trade_tags").insert(tagIds.map((t) => ({ trade_id: id, tag_id: t })));
  return id;
}

const tagsOf = async (tradeId: string) =>
  (await me.client.from("trade_tags").select("tag_id").eq("trade_id", tradeId)).data!.map(
    (r) => r.tag_id,
  );

describe("merge_tags / unmerge_tags", () => {
  it("moves every trade to the target, deletes the source, and undoes exactly", async () => {
    const from = await tag("dup");
    const into = await tag("keep");
    const onlyFrom = await trade([from]);
    const both = await trade([from, into]);
    const onlyInto = await trade([into]);

    const merged = await me.client.rpc("merge_tags", { p_from: from, p_into: into });
    expect(merged.error).toBeNull();
    const res = merged.data as { links: string[]; had_target: string[] };
    expect(res.links.toSorted()).toEqual([onlyFrom, both].toSorted());
    expect(res.had_target).toEqual([both]);
    expect(await tagsOf(onlyFrom)).toEqual([into]);
    expect(await tagsOf(both)).toEqual([into]);
    const src = await me.client.from("tags").select("deleted_at").eq("id", from).single();
    expect(src.data?.deleted_at).not.toBeNull();

    const undo = await me.client.rpc("unmerge_tags", {
      p_from: from,
      p_into: into,
      p_links: res.links,
      p_had_target: res.had_target,
    });
    expect(undo.error).toBeNull();
    expect(await tagsOf(onlyFrom)).toEqual([from]);
    expect((await tagsOf(both)).toSorted()).toEqual([from, into].toSorted());
    expect(await tagsOf(onlyInto)).toEqual([into]);
  });

  it("refuses self-merges, foreign tags and anonymous callers", async () => {
    const a = await tag("a");
    const self = await me.client.rpc("merge_tags", { p_from: a, p_into: a });
    expect(self.error?.code).toBe("22023");
    const foreign = await intruder.client.rpc("merge_tags", { p_from: a, p_into: a });
    expect(foreign.error).not.toBeNull();
    const b = await tag("b");
    const theirs = await intruder.client.rpc("merge_tags", { p_from: a, p_into: b });
    expect(theirs.error?.code).toBe("22023");
    const anon = await anonClient().rpc("merge_tags", { p_from: a, p_into: b });
    expect(anon.error).not.toBeNull();
  });
});

describe("tag_usage", () => {
  it("counts live trades per tag, only the caller's", async () => {
    const t = await tag("usage");
    const one = await trade([t]);
    await trade([t]);
    await me.client.from("trades").update({ deleted_at: new Date().toISOString() }).eq("id", one);
    const mine = await me.client.rpc("tag_usage");
    expect(mine.data?.find((u: { tag_id: string }) => u.tag_id === t)?.trades).toBe(1);
    const theirs = await intruder.client.rpc("tag_usage");
    expect(theirs.data?.find((u: { tag_id: string }) => u.tag_id === t)).toBeUndefined();
  });
});
