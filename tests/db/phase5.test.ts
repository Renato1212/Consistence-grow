import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { E2E_USER, INTRUDER_USER, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
});

const base = (id: string) => ({
  id,
  name: `PB ${id.slice(0, 6)}`,
  primary_domain: "TECHNICAL",
  status: "idea",
  edge_md: "first edge",
  checklist: [] as { id: string; text: string }[],
});

describe("save_playbook versioning", () => {
  it("creates v1, then one new version per editing session", async () => {
    const id = randomUUID();
    const s1 = randomUUID();
    const c1 = randomUUID();
    const save = (p: object, session: string) =>
      me.client.rpc("save_playbook", { p, p_session: session });

    const v1 = await save({ ...base(id), checklist: [{ id: c1, text: "First test?" }] }, s1);
    expect(v1.error).toBeNull();
    expect(v1.data).toBe(1);

    // Same session: structured edits update v1 in place
    expect(
      (
        await save(
          { ...base(id), edge_md: "better edge", checklist: [{ id: c1, text: "First test?" }] },
          s1,
        )
      ).data,
    ).toBe(1);

    // New session, notes-only change: no new version
    const s2 = randomUUID();
    expect(
      (
        await save(
          {
            ...base(id),
            edge_md: "better edge",
            notes_md: "just a note",
            checklist: [{ id: c1, text: "First test?" }],
          },
          s2,
        )
      ).data,
    ).toBe(1);

    // New session, structured change: v2, and further saves in s2 keep v2
    const c2 = randomUUID();
    const v2 = await save(
      {
        ...base(id),
        edge_md: "better edge",
        status: "testing",
        notes_md: "just a note",
        checklist: [
          { id: c1, text: "First test?" },
          { id: c2, text: "Size ok?" },
        ],
      },
      s2,
    );
    expect(v2.data).toBe(2);
    expect(
      (
        await save(
          {
            ...base(id),
            edge_md: "better edge",
            status: "active",
            notes_md: "just a note",
            checklist: [{ id: c2, text: "Size ok?" }],
          },
          s2,
        )
      ).data,
    ).toBe(2);

    const versions = await sql`
      select version, snapshot->>'status' as status, snapshot->'checklist' as checklist
        from public.playbook_versions where playbook_id = ${id} order by version`;
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, "idea"],
      [2, "active"],
    ]);
    expect(versions[0].checklist).toEqual(["First test?"]);
    expect(versions[1].checklist).toEqual(["Size ok?"]);

    const [pb] = await sql`select version, notes_md from public.playbooks where id = ${id}`;
    expect(pb).toMatchObject({ version: 2, notes_md: "just a note" });
    const [removed] =
      await sql`select deleted_at is not null as deleted from public.playbook_checklist_items where id = ${c1}`;
    expect(removed.deleted).toBe(true);
  });

  it("trades remember the version they were taken under and store the checklist", async () => {
    const id = randomUUID();
    await me.client.rpc("save_playbook", { p: base(id), p_session: randomUUID() });
    const es = (await me.client.from("instruments").select("id").eq("symbol", "ES").single()).data!;
    const trade = await me.client
      .from("trades")
      .insert({
        instrument_id: es.id,
        direction: "long",
        entry_at: "2044-03-01T15:00:00Z",
        entry_price: 5000,
        contracts: 1,
        playbook_id: id,
        checklist: { a: true, b: false },
      })
      .select("id, playbook_version, checklist")
      .single();
    expect(trade.error).toBeNull();
    expect(trade.data).toMatchObject({ playbook_version: 1, checklist: { a: true, b: false } });

    await me.client.rpc("save_playbook", {
      p: { ...base(id), status: "testing" },
      p_session: randomUUID(),
    });
    const again = await me.client
      .from("trades")
      .select("playbook_version")
      .eq("id", trade.data!.id)
      .single();
    expect(again.data!.playbook_version).toBe(1);
    const facts = await me.client
      .from("trade_facts")
      .select("checklist")
      .eq("id", trade.data!.id)
      .single();
    expect(facts.data!.checklist).toEqual({ a: true, b: false });

    const bad = await me.client
      .from("trades")
      .update({ checklist: [1, 2] })
      .eq("id", trade.data!.id);
    expect(bad.error).not.toBeNull();
  });

  it("rejects nameless playbooks and protects other users' playbooks", async () => {
    expect(
      (
        await me.client.rpc("save_playbook", {
          p: { id: randomUUID(), name: " ", primary_domain: "FLOW" },
          p_session: randomUUID(),
        })
      ).error,
    ).not.toBeNull();
    const id = randomUUID();
    await me.client.rpc("save_playbook", { p: base(id), p_session: randomUUID() });
    await intruder.client.rpc("save_playbook", {
      p: { ...base(id), name: "hacked" },
      p_session: randomUUID(),
    });
    const [pb] = await sql`select name from public.playbooks where id = ${id}`;
    expect(pb.name).not.toBe("hacked");
  });
});
