import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { prepareStatement } from "@/lib/statements/payload";
import { finestSplit, type SplitFill } from "@/lib/statements/split";

import {
  DEFAULT_PRODUCTS,
  MES_THREE_TRADES_PRODUCT,
  buildAxiaStatementPdf,
} from "../fixtures/axia-statement";
import { E2E_USER, INTRUDER_USER, signedIn } from "../local-supabase";

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
const account = `OBS_BUILD_${Date.now()}`;

function randomDay() {
  for (;;) {
    const d = new Date(Date.UTC(2045, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

type Fill = { id: string; side: "buy" | "sell"; qty: number; price: number };

async function saveDay(day: string, openCash = 25_000, replace = false) {
  const bytes = await buildAxiaStatementPdf({
    tradeDate: day,
    account,
    openCash,
    products: [MES_THREE_TRADES_PRODUCT, ...DEFAULT_PRODUCTS.filter((p) => p.code !== "MS")],
  });
  const { payload } = await prepareStatement(bytes);
  const r = await me.client.rpc("save_statement", { p_statement: payload, p_replace: replace });
  expect(r.error).toBeNull();
  const id = (r.data as { id: string }).id;
  const product = await me.client
    .from("statement_products")
    .select("id, realized_pnl")
    .eq("statement_id", id)
    .eq("code", "MS")
    .single();
  const fills = await me.client
    .from("statement_fills")
    .select("id, side, qty, price")
    .eq("statement_id", id)
    .eq("section", "confirmation")
    .eq("code", "MS")
    .order("seq");
  return {
    statementId: id,
    productId: product.data!.id as string,
    realized: Number(product.data!.realized_pnl),
    fills: (fills.data ?? []).map((f) => ({ ...f, price: Number(f.price) })) as Fill[],
  };
}

/** The finest split with directions from the fixture (long 2, short 3, long 1). */
function finestTrades(fills: Fill[], extra: (i: number) => Record<string, unknown> = () => ({})) {
  const split = finestSplit(fills as SplitFill[])!;
  return split.groups.map((g, i) => {
    const qty = g.reduce((s, a) => s + a.qty, 0) / 2;
    return {
      direction: qty === 3 ? "short" : "long",
      allocations: g.map((a) => ({ fill_id: a.fillId, qty: a.qty })),
      ...extra(i),
    };
  });
}

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
});

describe("build_statement_trades", () => {
  it("creates one journal trade per group that adds up to the broker, idempotently", async () => {
    const day = randomDay();
    const s = await saveDay(day);
    expect(s.realized).toBe(-1.25);
    const build = crypto.randomUUID();
    const trades = finestTrades(s.fills);
    expect(trades).toHaveLength(3);

    const r = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: build,
      p_method: "suggested",
      p_trades: trades,
    });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ status: "created", created: 3, linked: 0 });
    const ids = (r.data as { trade_ids: string[] }).trade_ids;

    const rows = await me.client
      .from("trade_facts")
      .select(
        "id, direction, contracts, gross_pnl, fees_total, needs_review, time_estimated, session, time_bucket, duration_sec, trade_date, broker_confirmed, import_hash",
      )
      .in("id", ids);
    expect(rows.data).toHaveLength(3);
    const sum = rows.data!.reduce((acc, t) => acc + Number(t.gross_pnl), 0);
    expect(sum).toBe(-1.25);
    for (const t of rows.data!) {
      expect(t).toMatchObject({
        needs_review: true,
        time_estimated: true,
        session: null,
        time_bucket: null,
        duration_sec: null,
        trade_date: day,
        broker_confirmed: true,
      });
      expect(Number(t.fees_total)).toBe(0);
      expect(t.import_hash).toMatch(/^stmt:/);
    }
    expect(rows.data!.map((t) => Number(t.gross_pnl)).sort((a, b) => a - b)).toEqual([
      -51.25, 20, 30,
    ]);

    const again = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: build,
      p_method: "suggested",
      p_trades: trades,
    });
    expect(again.data).toMatchObject({ status: "exists" });
    const other = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "one",
      p_trades: trades,
    });
    expect(other.error?.code).toBe("23505");

    const alloc = await me.client
      .from("statement_allocations")
      .select("qty, statement_trade:statement_trades!inner(product_id)")
      .eq("statement_trade.product_id", s.productId);
    expect(alloc.data!.reduce((acc, a) => acc + a.qty, 0)).toBe(14);

    // Undo: created trades go to the trash; the product can be built again.
    const undo = await me.client.rpc("undo_statement_build", { p_product: s.productId });
    expect(undo.error).toBeNull();
    expect((undo.data as { trashed: string[] }).trashed.sort()).toEqual([...ids].sort());
    const trashed = await me.client.from("trades").select("deleted_at").in("id", ids);
    expect(trashed.data!.every((t) => t.deleted_at !== null)).toBe(true);
  });

  it("rejects incomplete, unbalanced and foreign allocations", async () => {
    const s = await saveDay(randomDay());
    const trades = finestTrades(s.fills);
    const call = (p_trades: unknown) =>
      me.client.rpc("build_statement_trades", {
        p_product: s.productId,
        p_build: crypto.randomUUID(),
        p_method: "manual",
        p_trades,
      });

    const missing = await call(trades.slice(0, 2));
    expect(missing.error?.message).toMatch(/allocated exactly once/);

    const swapped = structuredClone(trades);
    const last = swapped[2].allocations.pop()!;
    swapped[0].allocations.push(last);
    const unbalanced = await call(swapped);
    expect(unbalanced.error?.message).toMatch(/must be flat/);

    const zn = await me.client
      .from("statement_fills")
      .select("id, statement:statements!inner(id)")
      .eq("code", "21")
      .eq(
        "statement.id",
        (
          await me.client
            .from("statement_products")
            .select("statement_id")
            .eq("id", s.productId)
            .single()
        ).data!.statement_id,
      )
      .limit(1)
      .single();
    const foreign = structuredClone(trades);
    foreign[0].allocations.push({ fill_id: zn.data!.id, qty: 1 });
    expect((await call(foreign)).error?.message).toMatch(/this product's priced fills/);

    const noDirection = structuredClone(trades) as Record<string, unknown>[];
    noDirection[0].direction = "up";
    expect((await call(noDirection)).error?.message).toMatch(/direction/);

    // The allocation guard also holds for direct writes.
    const ok = await call(trades);
    expect(ok.error).toBeNull();
    const st = await me.client
      .from("statement_trades")
      .select("id")
      .eq("product_id", s.productId)
      .is("deleted_at", null)
      .limit(1)
      .single();
    const over = await me.client
      .from("statement_allocations")
      .insert({ statement_trade_id: st.data!.id, fill_id: s.fills[0].id, qty: 1 });
    expect(over.error?.code).toBe("23514");
  });

  it("uses entered times, validates them, and an edited estimated time becomes exact", async () => {
    const day = randomDay();
    const s = await saveDay(day);
    const at = (h: number, m: number) =>
      new Date(
        `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
      ).toISOString();

    const wrongDay = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "manual",
      p_trades: finestTrades(s.fills, () => ({ entry_at: "2001-01-02T14:00:00Z" })),
    });
    expect(wrongDay.error?.message).toMatch(/entry time is not on/);
    const backwards = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "manual",
      p_trades: finestTrades(s.fills, () => ({ entry_at: at(14, 30), exit_at: at(14, 0) })),
    });
    expect(backwards.error?.message).toMatch(/exit before entry/);

    const r = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "manual",
      p_trades: finestTrades(s.fills, (i) =>
        i === 0 ? { entry_at: at(14, 35), exit_at: at(14, 50) } : {},
      ),
    });
    expect(r.error).toBeNull();
    const ids = (r.data as { trade_ids: string[] }).trade_ids;
    const first = await me.client
      .from("trades")
      .select("time_estimated, session, duration_sec")
      .eq("id", ids[0])
      .single();
    expect(first.data).toMatchObject({ time_estimated: false, session: "US", duration_sec: 900 });

    const edited = await me.client
      .from("trades")
      .update({ entry_at: at(9, 0), exit_at: at(9, 10) })
      .eq("id", ids[1])
      .select("time_estimated, session, duration_sec")
      .single();
    expect(edited.data).toMatchObject({ time_estimated: false, session: "EU", duration_sec: 600 });
  });

  it("links trades already in the journal instead of creating new ones", async () => {
    const day = randomDay();
    const s = await saveDay(day);
    const mes = await me.client
      .from("instruments")
      .select("id")
      .eq("symbol", "MES")
      .is("deleted_at", null)
      .single();
    const logged = await me.client
      .from("trades")
      .insert({
        instrument_id: mes.data!.id,
        direction: "short",
        contracts: 3,
        fees: 0,
        entry_at: `${day}T14:00:00Z`,
        exit_at: `${day}T14:10:00Z`,
        entry_price: 7760.25,
        exit_price: 7758.25,
      })
      .select("id")
      .single();
    const trades = finestTrades(s.fills, () => ({}));
    const idx = trades.findIndex((t) => t.direction === "short");
    (trades[idx] as Record<string, unknown>).link_trade_id = logged.data!.id;

    const r = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "journal",
      p_trades: trades,
    });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ created: 2, linked: 1 });
    const facts = await me.client
      .from("trade_facts")
      .select("broker_confirmed")
      .eq("id", logged.data!.id)
      .single();
    expect(facts.data!.broker_confirmed).toBe(true);

    const undo = await me.client.rpc("undo_statement_build", { p_product: s.productId });
    expect(undo.data).toMatchObject({ unlinked: 1 });
    const still = await me.client
      .from("trade_facts")
      .select("deleted_at, broker_confirmed")
      .eq("id", logged.data!.id)
      .single();
    expect(still.data).toMatchObject({ deleted_at: null, broker_confirmed: false });
  });

  it("shares statement fees by contract and instrument fee", async () => {
    const s = await saveDay(randomDay());
    await me.client.from("statements").update({ total_fees: 10 }).eq("id", s.statementId);
    const products = await me.client
      .from("statement_products")
      .select("long_qty, instrument:instruments(symbol, fee_per_contract)")
      .eq("statement_id", s.statementId);
    const rows = (products.data ?? []) as unknown as {
      long_qty: number;
      instrument: { symbol: string; fee_per_contract: number };
    }[];
    const byFee = rows.some((p) => Number(p.instrument.fee_per_contract) > 0);
    const w = (p: (typeof rows)[number]) => (byFee ? Number(p.instrument.fee_per_contract) : 1);
    const weight = rows.reduce((acc, p) => acc + w(p) * p.long_qty, 0);
    const mesUnit = w(rows.find((p) => p.instrument.symbol === "MES")!);

    const r = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "suggested",
      p_trades: finestTrades(s.fills),
    });
    expect(r.error).toBeNull();
    const st = await me.client
      .from("statement_trades")
      .select("contracts, fees")
      .eq("product_id", s.productId)
      .is("deleted_at", null);
    for (const t of st.data!)
      expect(Number(t.fees)).toBe(Math.round(((10 * mesUnit * t.contracts) / weight) * 100) / 100);
  });

  it("keeps the build when a corrected statement with the same fills replaces it", async () => {
    const day = randomDay();
    const s = await saveDay(day);
    const r = await me.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "suggested",
      p_trades: finestTrades(s.fills),
    });
    expect(r.error).toBeNull();
    const corrected = await saveDay(day, 30_000, true);
    expect(corrected.statementId).not.toBe(s.statementId);
    const st = await me.client
      .from("statement_trades")
      .select("statement_id, product_id, allocations:statement_allocations(fill_id)")
      .eq(
        "build_id",
        (
          await me.client
            .from("statement_trades")
            .select("build_id")
            .eq("product_id", corrected.productId)
            .limit(1)
            .single()
        ).data!.build_id,
      )
      .is("deleted_at", null);
    expect(st.data).toHaveLength(3);
    const newFills = new Set(corrected.fills.map((f) => f.id));
    for (const t of st.data!) {
      expect(t.statement_id).toBe(corrected.statementId);
      for (const a of t.allocations as { fill_id: string }[])
        expect(newFills.has(a.fill_id)).toBe(true);
    }
  });

  it("is invisible and unusable for another user", async () => {
    const s = await saveDay(randomDay());
    const seen = await intruder.client
      .from("statement_trades")
      .select("id")
      .eq("product_id", s.productId);
    expect(seen.data).toEqual([]);
    const r = await intruder.client.rpc("build_statement_trades", {
      p_product: s.productId,
      p_build: crypto.randomUUID(),
      p_method: "suggested",
      p_trades: finestTrades(s.fills),
    });
    expect(r.error?.code).toBe("P0002");
    const anon = await intruder.client.rpc("undo_statement_build", { p_product: s.productId });
    expect(anon.data).toMatchObject({ trashed: [], unlinked: 0 });
  });
});
