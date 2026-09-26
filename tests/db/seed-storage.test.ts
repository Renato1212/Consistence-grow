import { afterAll, describe, expect, it } from "vitest";

import { E2E_USER, INTRUDER_USER, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

describe("default reference data", () => {
  it("every new user gets settings, 23 instruments, the tag vocabulary, rule and draft playbooks", async () => {
    const { userId } = await signedIn(E2E_USER);
    const [row] = await sql`
      select
        (select count(*) from public.user_settings where user_id = ${userId})::int as settings,
        (select count(*) from public.instruments where user_id = ${userId})::int as instruments,
        (select count(*) from public.tag_groups where user_id = ${userId})::int as groups,
        (select count(*) from public.tags where user_id = ${userId})::int as tags,
        (select count(*) from public.rules where user_id = ${userId} and text like 'Be flat%')::int as rules,
        (select count(*) from public.playbooks where user_id = ${userId})::int as playbooks,
        (select count(*) from public.playbook_versions where user_id = ${userId})::int as versions`;
    expect(row).toMatchObject({
      settings: 1,
      instruments: 23,
      groups: 4,
      tags: 53,
      rules: 1,
    });
    expect(row.playbooks).toBeGreaterThanOrEqual(2);
    expect(row.versions).toBeGreaterThanOrEqual(2);
  });

  it("seeding is idempotent", async () => {
    const { userId } = await signedIn(E2E_USER);
    const count = async () =>
      (await sql`select count(*)::int as n from public.tags where user_id = ${userId}`)[0].n;
    const before = await count();
    await sql`select private.seed_user_defaults(${userId}::uuid)`;
    await sql`select private.seed_user_defaults(${userId}::uuid)`;
    expect(await count()).toBe(before);
  });

  it("the seed function cannot be called by app users", async () => {
    const { client } = await signedIn(E2E_USER);
    const { error } = await client.schema("private" as "public").rpc("seed_user_defaults", {
      p_user: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });
});

describe("media storage", () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

  it("I can upload and read under my own folder; others cannot", async () => {
    const me = await signedIn(E2E_USER);
    const intruder = await signedIn(INTRUDER_USER);
    const path = `${me.userId}/trade/test/${Date.now()}.png`;

    const up = await me.client.storage
      .from("media")
      .upload(path, png, { contentType: "image/png" });
    expect(up.error).toBeNull();

    const mine = await me.client.storage.from("media").createSignedUrl(path, 60);
    expect(mine.error).toBeNull();

    const theirs = await intruder.client.storage.from("media").createSignedUrl(path, 60);
    expect(theirs.error).not.toBeNull();

    const plant = await intruder.client.storage
      .from("media")
      .upload(`${me.userId}/trade/test/planted-${Date.now()}.png`, png, {
        contentType: "image/png",
      });
    expect(plant.error).not.toBeNull();

    const del = await intruder.client.storage.from("media").remove([path]);
    expect(del.data ?? []).toHaveLength(0);
    const still = await me.client.storage.from("media").createSignedUrl(path, 60);
    expect(still.error).toBeNull();
  });

  it("rejects disallowed file types", async () => {
    const me = await signedIn(E2E_USER);
    const exe = new Blob(["MZ"], { type: "application/x-msdownload" });
    const up = await me.client.storage
      .from("media")
      .upload(`${me.userId}/trade/test/bad-${Date.now()}.exe`, exe, {
        contentType: "application/x-msdownload",
      });
    expect(up.error).not.toBeNull();
  });
});
