import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { planRestore } from "@/lib/export/restore";
import { prepareStatement } from "@/lib/statements/payload";

import { DEFAULT_PRODUCTS, buildAxiaStatementPdf } from "../fixtures/axia-statement";
import { E2E_USER, INTRUDER_USER, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
});

async function restore(client: SupabaseClient, json: string) {
  const plan = planRestore(json);
  if (!plan.ok) throw new Error(plan.error);
  let n = 0;
  for (const step of plan.steps) {
    const r = await client.rpc("restore_rows", { p_table: step.table, p_rows: step.rows });
    if (r.error) throw r.error;
    n += Number(r.data);
  }
  return n;
}

describe("restore drill", () => {
  it("puts back hard-deleted trades, fills, tags and statements exactly; twice is a no-op", async () => {
    // A trade with fills and a tag, and a statement with products and fills.
    const es = await me.client
      .from("instruments")
      .select("id")
      .eq("symbol", "ES")
      .is("deleted_at", null)
      .single();
    const imported = await me.client.rpc("import_trades", {
      p_trades: [
        {
          import_hash: randomUUID(),
          instrument_id: es.data!.id,
          direction: "long",
          entry_at: "2044-05-02T14:00:00Z",
          exit_at: "2044-05-02T14:10:00Z",
          entry_price: 5000,
          exit_price: 5003,
          contracts: 2,
          fees: 4,
          fills: [
            {
              hash: randomUUID(),
              executed_at: "2044-05-02T14:00:00Z",
              account: "A",
              symbol: "ESM4",
              side: "buy",
              price: 5000,
              qty: 2,
              raw: {},
            },
            {
              hash: randomUUID(),
              executed_at: "2044-05-02T14:10:00Z",
              account: "A",
              symbol: "ESM4",
              side: "sell",
              price: 5003,
              qty: 2,
              raw: {},
            },
          ],
        },
      ],
    });
    const tradeId = (imported.data as { trade_ids: string[] }).trade_ids[0];
    const tag = await me.client.from("tags").select("id").is("deleted_at", null).limit(1).single();
    await me.client.from("trade_tags").insert({ trade_id: tradeId, tag_id: tag.data!.id });
    const pdf = await buildAxiaStatementPdf({
      tradeDate: "2044-05-02",
      account: `RESTORE_${Date.now()}`,
      products: DEFAULT_PRODUCTS,
    });
    const saved = await me.client.rpc("save_statement", {
      p_statement: (await prepareStatement(pdf)).payload,
    });
    const statementId = (saved.data as { id: string }).id;

    // The "backup": those rows as the export writes them.
    const pick = async (table: string, col: string, id: string) =>
      (await me.client.from(table).select("*").eq(col, id)).data ?? [];
    const before = {
      trades: await pick("trades", "id", tradeId),
      fills: await pick("fills", "trade_id", tradeId),
      trade_tags: await pick("trade_tags", "trade_id", tradeId),
      statements: await pick("statements", "id", statementId),
      statement_products: await pick("statement_products", "statement_id", statementId),
      statement_fills: await pick("statement_fills", "statement_id", statementId),
    };
    const backup = JSON.stringify({
      version: 1,
      exported_at: new Date().toISOString(),
      tables: before,
    });

    // Disaster: gone for good (as after the 30-day purge).
    await sql`delete from public.trades where id = ${tradeId}`;
    await sql`delete from public.statements where id = ${statementId}`;
    expect((await pick("fills", "trade_id", tradeId)).length).toBe(0);

    const restored = await restore(me.client, backup);
    const expected = Object.values(before).reduce((n, rows) => n + rows.length, 0);
    expect(restored).toBe(expected);

    const after = await pick("trades", "id", tradeId);
    const strip = (row: Record<string, unknown>) => {
      const copy = { ...row };
      delete copy.updated_at;
      return copy;
    };
    expect(after.map(strip)).toEqual(before.trades.map(strip));
    expect((await pick("fills", "trade_id", tradeId)).length).toBe(before.fills.length);
    expect((await pick("trade_tags", "trade_id", tradeId)).length).toBe(1);
    const st = await pick("statements", "id", statementId);
    expect(st[0]).toMatchObject({ net_pnl: before.statements[0].net_pnl, status: "ok" });
    expect((await pick("statement_fills", "statement_id", statementId)).length).toBe(
      before.statement_fills.length,
    );

    // Running it again changes nothing.
    expect(await restore(me.client, backup)).toBe(0);
  });

  it("always writes the caller's own rows and refuses tables outside the list", async () => {
    const rule = { id: randomUUID(), user_id: me.userId, text: "planted", category: "general" };
    const r = await intruder.client.rpc("restore_rows", { p_table: "rules", p_rows: [rule] });
    expect(r.error).toBeNull();
    const [owner] = await sql`select user_id from public.rules where id = ${rule.id}`;
    expect(owner.user_id).toBe(intruder.userId);
    const mine = await me.client.from("rules").select("id").eq("id", rule.id);
    expect(mine.data).toHaveLength(0);

    const tokens = await me.client.rpc("restore_rows", { p_table: "api_tokens", p_rows: [] });
    expect(tokens.error?.code).toBe("22023");
    const auth = await me.client.rpc("restore_rows", { p_table: "pg_authid", p_rows: [] });
    expect(auth.error?.code).toBe("22023");
  });
});
