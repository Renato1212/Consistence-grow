import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { generateToken, hashToken, tokenPrefix } from "@/lib/briefs/token";
import { E2E_USER, INTRUDER_USER, anonClient, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };

async function makeToken(client: SupabaseClient, scopes: string[]) {
  const token = generateToken();
  const { error } = await client.from("api_tokens").insert({
    name: `test ${scopes.join("+")}`,
    token_hash: await hashToken(token),
    prefix: tokenPrefix(token),
    scopes,
  });
  expect(error).toBeNull();
  return token;
}

let aiToken: string;
let briefToken: string;
let intruderAi: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  aiToken = await makeToken(me.client, ["ai"]);
  briefToken = await makeToken(me.client, ["briefs"]);
  intruderAi = await makeToken(intruder.client, ["ai"]);
});

const anon = () => anonClient();
const key = () =>
  `range=custom&from=20${40 + Math.floor(Math.random() * 50)}-01-01&k=${Math.random()}`;

describe("token scopes", () => {
  it("existing and new tokens default to briefs only; scopes are validated", async () => {
    const t = generateToken();
    const ins = await me.client
      .from("api_tokens")
      .insert({ name: "default", token_hash: await hashToken(t), prefix: tokenPrefix(t) })
      .select("scopes")
      .single();
    expect(ins.data?.scopes).toEqual(["briefs"]);
    const t2 = generateToken();
    const bad = await me.client.from("api_tokens").insert({
      name: "bad",
      token_hash: await hashToken(t2),
      prefix: tokenPrefix(t2),
      scopes: ["admin"],
    });
    expect(bad.error).not.toBeNull();
  });

  it("a briefs token cannot read the AI context; an AI token cannot deliver briefs", async () => {
    const ctx = await anon().rpc("ai_context", { p_token: briefToken });
    expect(ctx.error?.code).toBe("28000");
    const brief = await anon().rpc("ingest_brief", {
      p_token: aiToken,
      p_session: "EU",
      p_markdown: "x",
    });
    expect(brief.error?.code).toBe("28000");
    const ok = await anon().rpc("ingest_brief", {
      p_token: briefToken,
      p_session: "EU",
      p_markdown: "## ok",
      p_date: "2049-01-04",
    });
    expect(ok.error).toBeNull();
  });
});

describe("ai queue", () => {
  it("returns only the owner's data", async () => {
    const mine = await anon().rpc("ai_context", { p_token: aiToken });
    expect(mine.error).toBeNull();
    const [count] =
      await sql`select count(*)::int as n from public.trades where user_id = ${me.userId} and deleted_at is null`;
    const ctx = mine.data as { trades: { id: string }[]; pattern_min_n: number };
    expect(ctx.trades.length).toBe(Math.min(count.n, 10000));
    expect(typeof ctx.pattern_min_n).toBe("number");
    const theirs = await anon().rpc("ai_context", { p_token: intruderAi });
    const tIds = new Set((theirs.data as { trades: { id: string }[] }).trades.map((t) => t.id));
    expect(ctx.trades.some((t) => tIds.has(t.id))).toBe(false);
    const bad = await anon().rpc("ai_context", { p_token: "cg_nope" });
    expect(bad.error?.code).toBe("28000");
  });

  it("enqueue is idempotent while open; serve → submit stores findings; resubmit is a no-op", async () => {
    const fk = key();
    const args = {
      p_token: aiToken,
      p_kind: "session",
      p_slot: "eu",
      p_label: "Pre-EU",
      p_filter: { range: "90d" },
      p_filter_key: fk,
    };
    const a = await anon().rpc("ai_enqueue", args);
    const b = await anon().rpc("ai_enqueue", args);
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    const id = a.data as string;

    const ctx = await anon().rpc("ai_context", { p_token: aiToken });
    expect((ctx.data as { requests: { id: string }[] }).requests.map((r) => r.id)).toContain(id);

    // Submitting before serving is refused.
    const early = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_output: { findings: [] },
      p_model: "claude",
    });
    expect(early.error?.code).toBe("22023");

    const [trade] =
      await sql`select id from public.trades where user_id = ${me.userId} and deleted_at is null limit 1`;
    const [other] =
      await sql`select id from public.trades where user_id = ${intruder.userId} limit 1`;
    const tradeIds = trade ? [trade.id] : [];
    const served = await anon().rpc("ai_serve", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_trade_ids: tradeIds,
      p_playbook_ids: [],
    });
    expect(served.error).toBeNull();

    const finding = (ids: string[], playbook: string | null = null) => ({
      summary: "s",
      findings: [
        {
          title: "t",
          observation: "o",
          evidence_trade_ids: ids,
          sample_size: 1,
          confidence: "low",
          suggested_experiment: "e",
          related_playbook_id: playbook,
        },
      ],
    });
    if (other) {
      const foreign = await anon().rpc("ai_submit", {
        p_token: aiToken,
        p_request: id,
        p_data_hash: "h1",
        p_output: finding([other.id]),
        p_model: "claude",
      });
      expect(foreign.error?.code).toBe("22023");
      expect(foreign.error?.message).toContain("not in the payload");
    }
    const junk = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_output: finding(["not-a-uuid"]),
      p_model: "claude",
    });
    expect(junk.error?.code).toBe("22023");
    const badPlaybook = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_output: finding(tradeIds, "00000000-0000-0000-0000-000000000000"),
      p_model: "claude",
    });
    expect(badPlaybook.error?.message).toContain("related_playbook_id");
    const stale = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "other",
      p_output: finding(tradeIds),
      p_model: "claude",
    });
    expect(stale.error?.message).toContain("data changed");

    const ok = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_output: finding(tradeIds),
      p_model: "claude-opus-5",
    });
    expect(ok.error).toBeNull();
    const again = await anon().rpc("ai_submit", {
      p_token: aiToken,
      p_request: id,
      p_data_hash: "h1",
      p_output: finding(tradeIds),
      p_model: "claude-opus-5",
    });
    expect(again.data).toBe(ok.data);

    const req = await me.client
      .from("ai_requests")
      .select("status, insight_id")
      .eq("id", id)
      .single();
    expect(req.data).toEqual({ status: "done", insight_id: ok.data });
    const ins = await me.client
      .from("ai_insights")
      .select("scope, model, filter_key, request_id")
      .eq("id", ok.data as string)
      .single();
    expect(ins.data).toEqual({
      scope: "session",
      model: "claude-opus-5",
      filter_key: fk,
      request_id: id,
    });
    // A new enqueue for the same filter opens a fresh request.
    const next = await anon().rpc("ai_enqueue", args);
    expect(next.data).not.toBe(id);
  });

  it("another user's token cannot serve, submit or fail my requests", async () => {
    const q = await me.client
      .from("ai_requests")
      .insert({ kind: "filter", label: "mine", filter_key: key() })
      .select("id")
      .single();
    expect(q.error).toBeNull();
    const id = q.data!.id;
    const serve = await anon().rpc("ai_serve", {
      p_token: intruderAi,
      p_request: id,
      p_data_hash: "x",
      p_trade_ids: [],
      p_playbook_ids: [],
    });
    expect(serve.error?.code).toBe("P0002");
    await anon().rpc("ai_fail", { p_token: intruderAi, p_request: id, p_error: "nope" });
    const still = await me.client.from("ai_requests").select("status").eq("id", id).single();
    expect(still.data?.status).toBe("pending");
    const theirs = await intruder.client.from("ai_requests").select("id").eq("id", id);
    expect(theirs.data).toHaveLength(0);

    const failed = await anon().rpc("ai_fail", {
      p_token: aiToken,
      p_request: id,
      p_error: "No trades in this filter",
    });
    expect(failed.error).toBeNull();
    const done = await me.client.from("ai_requests").select("status, error").eq("id", id).single();
    expect(done.data).toEqual({ status: "failed", error: "No trades in this filter" });
  });

  it("the functions are not callable by signed-in users", async () => {
    const r = await me.client.rpc("ai_context", { p_token: aiToken });
    expect(r.error).not.toBeNull();
  });
});

describe("append_playbook_note", () => {
  it("appends to my playbook's notes without a new version; not to others'", async () => {
    const pb = await me.client
      .from("playbooks")
      .insert({ name: `Note test ${Date.now()}`, primary_domain: "DATA" })
      .select("id, version")
      .single();
    expect(pb.error).toBeNull();
    const first = await me.client.rpc("append_playbook_note", {
      p_playbook: pb.data!.id,
      p_text: "AI: first",
    });
    expect(first.data).toBe(true);
    await me.client.rpc("append_playbook_note", { p_playbook: pb.data!.id, p_text: "AI: second" });
    const row = await me.client
      .from("playbooks")
      .select("notes_md, version")
      .eq("id", pb.data!.id)
      .single();
    expect(row.data).toEqual({ notes_md: "AI: first\n\nAI: second", version: pb.data!.version });
    const foreign = await intruder.client.rpc("append_playbook_note", {
      p_playbook: pb.data!.id,
      p_text: "hack",
    });
    expect(foreign.data).toBeNull();
  });
});
