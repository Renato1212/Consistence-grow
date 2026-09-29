import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { prepareStatement, statementFilePath } from "@/lib/statements/payload";
import { generateToken, hashToken, tokenPrefix } from "@/lib/briefs/token";

import { DEFAULT_PRODUCTS, buildAxiaStatementPdf } from "../fixtures/axia-statement";
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
const account = `OBS_DB_${Date.now()}`;

/** A statement for a random far-future weekday so reruns never collide. */
function randomDay() {
  const d = new Date(Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function payloadFor(tradeDate: string, openCash = 25_000) {
  const bytes = await buildAxiaStatementPdf({
    tradeDate,
    account,
    openCash,
    products: DEFAULT_PRODUCTS,
  });
  return (await prepareStatement(bytes, { fileName: "s.pdf" })).payload;
}

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
});

describe("instruments", () => {
  it("seeds MCL and MGC for existing users", async () => {
    const r = await me.client
      .from("instruments")
      .select("symbol, tick_size, tick_value")
      .in("symbol", ["MCL", "MGC"])
      .is("deleted_at", null)
      .order("symbol");
    expect(r.data?.map((i) => [i.symbol, Number(i.tick_size), Number(i.tick_value)])).toEqual([
      ["MCL", 0.01, 1],
      ["MGC", 0.1, 1],
    ]);
  });
});

describe("save_statement", () => {
  it("stores the statement, products (mapped to instruments) and fills", async () => {
    const payload = await payloadFor(randomDay());
    const r = await me.client.rpc("save_statement", { p_statement: payload });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ status: "created" });
    const id = (r.data as { id: string }).id;

    const st = await me.client.from("statements").select("*").eq("id", id).single();
    expect(st.data).toMatchObject({
      account,
      status: "ok",
      simulated: true,
      source: "upload",
      realized_pnl: payload.realized_pnl,
      net_pnl: payload.realized_pnl,
      contracts: payload.contracts,
    });
    const products = await me.client
      .from("statement_products")
      .select("code, price_scale, instrument:instruments(symbol)")
      .eq("statement_id", id)
      .order("code");
    expect(
      products.data?.map((p) => [
        p.code,
        (p.instrument as unknown as { symbol: string } | null)?.symbol,
        Number(p.price_scale),
      ]),
    ).toEqual([
      ["21", "ZN", 1],
      ["EF", "MCL", 1],
      ["J1", "6J", 0.0001],
      ["MS", "MES", 1],
    ]);
    const fills = await me.client
      .from("statement_fills")
      .select("id", { count: "exact", head: true })
      .eq("statement_id", id);
    expect(fills.count).toBe(payload.fills.length);
  });

  it("is idempotent per file and asks before replacing a different file for the same day", async () => {
    const day = randomDay();
    const first = await payloadFor(day);
    const created = await me.client.rpc("save_statement", { p_statement: first });
    const id = (created.data as { id: string }).id;

    const dup = await me.client.rpc("save_statement", { p_statement: first });
    expect(dup.data).toEqual({ status: "duplicate", id });

    const corrected = await payloadFor(day, 30_000);
    const conflict = await me.client.rpc("save_statement", { p_statement: corrected });
    expect(conflict.data).toEqual({ status: "conflict", id });
    const still = await me.client.from("statements").select("close_cash").eq("id", id).single();
    expect(Number(still.data?.close_cash)).toBe(first.close_cash);

    const replaced = await me.client.rpc("save_statement", {
      p_statement: corrected,
      p_replace: true,
    });
    expect(replaced.data).toMatchObject({ status: "replaced", replaced_id: id });
    const active = await me.client
      .from("statements")
      .select("id, close_cash")
      .eq("account", account)
      .eq("trade_date", day)
      .is("deleted_at", null);
    expect(active.data).toHaveLength(1);
    expect(Number(active.data![0].close_cash)).toBe(corrected.close_cash);
    const old = await me.client.from("statements").select("deleted_at").eq("id", id).single();
    expect(old.data?.deleted_at).not.toBeNull();
  });

  it("rejects incomplete payloads and anonymous callers", async () => {
    const bad = await me.client.rpc("save_statement", { p_statement: { account: "x" } });
    expect(bad.error?.code).toBe("22023");
    const anon = await anonClient().rpc("save_statement", {
      p_statement: await payloadFor(randomDay()),
    });
    expect(anon.error).not.toBeNull();
  });

  it("keeps every statement row private", async () => {
    const r = await me.client.rpc("save_statement", {
      p_statement: await payloadFor(randomDay()),
    });
    const id = (r.data as { id: string }).id;
    for (const table of ["statements", "statement_products", "statement_fills"] as const) {
      const col = table === "statements" ? "id" : "statement_id";
      const peek = await intruder.client.from(table).select("id").eq(col, id);
      expect(peek.data, table).toHaveLength(0);
    }
    const write = await intruder.client
      .from("statements")
      .update({ realized_pnl: 1 })
      .eq("id", id)
      .select("id");
    expect(write.data ?? []).toHaveLength(0);
  });
});

describe("map_statement_code", () => {
  it("remaps past products, applies to new statements, and reverts to the default", async () => {
    const es = await me.client
      .from("instruments")
      .select("id")
      .eq("symbol", "ES")
      .is("deleted_at", null)
      .single();
    const r = await me.client.rpc("save_statement", {
      p_statement: await payloadFor(randomDay()),
    });
    const id = (r.data as { id: string }).id;

    const n = await me.client.rpc("map_statement_code", {
      p_code: "MS",
      p_instrument: es.data!.id,
      p_price_scale: 1,
    });
    expect(n.error).toBeNull();
    const mapped = await me.client
      .from("statement_products")
      .select("instrument_id")
      .eq("statement_id", id)
      .eq("code", "MS")
      .single();
    expect(mapped.data?.instrument_id).toBe(es.data!.id);

    const next = await me.client.rpc("save_statement", {
      p_statement: await payloadFor(randomDay()),
    });
    const nextId = (next.data as { id: string }).id;
    const applied = await me.client
      .from("statement_products")
      .select("instrument_id")
      .eq("statement_id", nextId)
      .eq("code", "MS")
      .single();
    expect(applied.data?.instrument_id).toBe(es.data!.id);

    await me.client.rpc("map_statement_code", { p_code: "MS", p_instrument: null });
    const reverted = await me.client
      .from("statement_products")
      .select("instrument:instruments(symbol)")
      .eq("statement_id", id)
      .eq("code", "MS")
      .single();
    expect((reverted.data?.instrument as unknown as { symbol: string }).symbol).toBe("MES");
  });
});

describe("ingest_statement (token)", () => {
  async function makeToken(scopes: string[]) {
    const token = generateToken();
    const { error } = await me.client.from("api_tokens").insert({
      name: `statements test ${scopes.join("+")}`,
      token_hash: await hashToken(token),
      prefix: tokenPrefix(token),
      scopes,
    });
    expect(error).toBeNull();
    return token;
  }

  it("needs the statements scope, ignores a client file path, and is anon-only", async () => {
    const good = await makeToken(["statements"]);
    const briefsOnly = await makeToken(["briefs"]);
    const payload = { ...(await payloadFor(randomDay())), file_path: "someone/else.pdf" };

    const denied = await anonClient().rpc("ingest_statement", {
      p_token: briefsOnly,
      p_statement: payload,
    });
    expect(denied.error?.code).toBe("28000");

    const ok = await anonClient().rpc("ingest_statement", { p_token: good, p_statement: payload });
    expect(ok.error).toBeNull();
    const id = (ok.data as { id: string }).id;
    const row = await me.client
      .from("statements")
      .select("source, file_path, user_id")
      .eq("id", id)
      .single();
    expect(row.data).toEqual({ source: "api", file_path: null, user_id: me.userId });

    const aiToken = await makeToken(["ai"]);
    const forAi = await anonClient().rpc("ai_statements", { p_token: aiToken });
    expect(forAi.error).toBeNull();
    expect(Array.isArray(forAi.data)).toBe(true);
    const wrongScope = await anonClient().rpc("ai_statements", { p_token: good });
    expect(wrongScope.error?.code).toBe("28000");

    const signedInCall = await me.client.rpc("ingest_statement", {
      p_token: good,
      p_statement: payload,
    });
    expect(signedInCall.error).not.toBeNull();
  });
});

describe("statements bucket and purge", () => {
  it("owners read and write only their folder", async () => {
    const payload = await payloadFor(randomDay());
    const path = statementFilePath(me.userId, payload);
    const pdf = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
    const up = await me.client.storage.from("statements").upload(path, pdf, { upsert: true });
    expect(up.error).toBeNull();
    const foreign = await intruder.client.storage
      .from("statements")
      .upload(`${me.userId}/evil.pdf`, pdf);
    expect(foreign.error).not.toBeNull();
    const peek = await intruder.client.storage.from("statements").download(path);
    expect(peek.data).toBeNull();
  });

  it("purges old trashed statements with their children and returns the PDF paths", async () => {
    const payload = { ...(await payloadFor(randomDay())) };
    payload.file_path = statementFilePath(me.userId, payload);
    const r = await me.client.rpc("save_statement", { p_statement: payload });
    const id = (r.data as { id: string }).id;
    await sql`update public.statements set deleted_at = now() - interval '31 days' where id = ${id}`;

    const out = await adminClient().rpc("purge_trash", { p_user: me.userId });
    expect(out.error).toBeNull();
    const res = out.data as { statement_paths: string[] };
    expect(res.statement_paths).toContain(payload.file_path);
    const [left] = await sql`
      select (select count(*)::int from public.statements where id = ${id}) as s,
             (select count(*)::int from public.statement_fills where statement_id = ${id}) as f`;
    expect([left.s, left.f]).toEqual([0, 0]);
  });
});
