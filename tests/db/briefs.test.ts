import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { generateToken, hashToken, tokenPrefix } from "@/lib/briefs/token";
import { E2E_USER, INTRUDER_USER, anonClient, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let token: string;
let tokenId: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  token = generateToken();
  const ins = await me.client
    .from("api_tokens")
    .insert({ name: "test", token_hash: await hashToken(token), prefix: tokenPrefix(token) })
    .select("id")
    .single();
  expect(ins.error).toBeNull();
  tokenId = ins.data!.id;
});

const date = () =>
  new Date(Date.UTC(2046, 0, 1) + Math.floor(Math.random() * 4000) * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe("ingest_brief", () => {
  it("stores a brief for the token's owner, anonymously, and replaces on resend", async () => {
    const d = date();
    const anon = anonClient();
    const first = await anon.rpc("ingest_brief", {
      p_token: token,
      p_session: "EU",
      p_markdown: "## 0. TL;DR\n- first",
      p_date: d,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ date: d, session: "EU" });

    const again = await anon.rpc("ingest_brief", {
      p_token: token,
      p_session: "EU",
      p_markdown: "## 0. TL;DR\n- second",
      p_date: d,
    });
    expect((again.data as { id: string }).id).toBe((first.data as { id: string }).id);

    const mine = await me.client.from("briefs").select("markdown, user_id").eq("date", d);
    expect(mine.data).toEqual([{ markdown: "## 0. TL;DR\n- second", user_id: me.userId }]);
    const theirs = await intruder.client.from("briefs").select("id").eq("date", d);
    expect(theirs.data).toHaveLength(0);

    const [t] =
      await sql`select last_used_at is not null as used from public.api_tokens where id = ${tokenId}`;
    expect(t.used).toBe(true);
  });

  it("matches the browser hash with Postgres sha256", async () => {
    const [row] = await sql`select encode(sha256(convert_to(${token}, 'UTF8')), 'hex') as h`;
    expect(row.h).toBe(await hashToken(token));
  });

  it("rejects bad tokens, revoked tokens and bad input", async () => {
    const anon = anonClient();
    const bad = await anon.rpc("ingest_brief", {
      p_token: "cg_nope",
      p_session: "EU",
      p_markdown: "x",
    });
    expect(bad.error?.code).toBe("28000");

    const edition = await anon.rpc("ingest_brief", {
      p_token: token,
      p_session: "ASIA",
      p_markdown: "x",
    });
    expect(edition.error?.code).toBe("22023");
    const empty = await anon.rpc("ingest_brief", {
      p_token: token,
      p_session: "US",
      p_markdown: " ",
    });
    expect(empty.error?.code).toBe("22023");

    const t2 = generateToken();
    const ins = await me.client
      .from("api_tokens")
      .insert({ name: "revoked", token_hash: await hashToken(t2), prefix: tokenPrefix(t2) })
      .select("id")
      .single();
    await me.client
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", ins.data!.id);
    const revoked = await anon.rpc("ingest_brief", {
      p_token: t2,
      p_session: "US",
      p_markdown: "x",
    });
    expect(revoked.error?.code).toBe("28000");
  });

  it("tokens are private to their owner", async () => {
    const theirs = await intruder.client.from("api_tokens").select("id").eq("id", tokenId);
    expect(theirs.data).toHaveLength(0);
    const anon = await anonClient().from("api_tokens").select("id");
    expect(anon.data ?? []).toHaveLength(0);
  });
});
