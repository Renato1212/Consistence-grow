import "server-only";

import type { Allocation, Direction, JournalCandidate, Side } from "@/lib/statements/split";
import { createClient } from "@/lib/supabase/server";

import { fetchAll } from "./paginate";

/** A broker fill of the day, price in instrument units (statement price × scale). */
export type BuildFill = { id: string; side: Side; qty: number; price: number; priceText: string };

export type BuiltTrade = {
  id: string;
  seq: number;
  origin: "created" | "linked";
  method: string;
  direction: Direction;
  contracts: number;
  avgBuy: number;
  avgSell: number;
  gross: number;
  fees: number;
  timeEstimated: boolean;
  tradeId: string | null;
  /** The journal trade is in the trash (or gone). */
  tradeMissing: boolean;
  /** The owner already worked on it (domain set / reviewed). */
  reviewed: boolean;
  allocations: Allocation[];
};

export type JournalOption = JournalCandidate & {
  entryAt: string;
  gross: number | null;
  timeEstimated: boolean;
};

export type BuildProduct = {
  productId: string;
  code: string;
  contract: string;
  description: string;
  symbol: string | null;
  instrumentId: string | null;
  tickSize: number | null;
  tickValue: number | null;
  priceScale: number;
  realized: number | null;
  fills: BuildFill[];
  built: BuiltTrade[];
  /** Journal trades of this instrument and day not linked to any statement. */
  journal: JournalOption[];
};

/** Everything the trade builder needs for one statement. */
export async function loadStatementBuild(
  statementId: string,
  tradeDate: string,
): Promise<BuildProduct[]> {
  const supabase = await createClient();
  const [products, fills, built] = await Promise.all([
    supabase
      .from("statement_products")
      .select(
        "id, code, contract, description, instrument_id, price_scale, realized_pnl, instrument:instruments(symbol, tick_size, tick_value)",
      )
      .eq("statement_id", statementId)
      .order("code"),
    fetchAll(
      (from, to) =>
        supabase
          .from("statement_fills")
          .select("id, side, qty, price, price_text, code, contract")
          .eq("statement_id", statementId)
          .eq("section", "confirmation")
          .eq("trade_date", tradeDate)
          .order("seq")
          .range(from, to),
      20000,
    ),
    supabase
      .from("statement_trades")
      .select(
        "id, seq, origin, method, product_id, direction, contracts, avg_buy, avg_sell, gross_pnl, fees, time_estimated, trade_id, allocations:statement_allocations(fill_id, qty, deleted_at), trade:trades(deleted_at, needs_review, primary_domain)",
      )
      .eq("statement_id", statementId)
      .is("deleted_at", null)
      .order("seq"),
  ]);
  if (products.error) throw products.error;
  if (built.error) throw built.error;

  type P = {
    id: string;
    code: string;
    contract: string;
    description: string;
    instrument_id: string | null;
    price_scale: number;
    realized_pnl: number | null;
    instrument: { symbol: string; tick_size: number; tick_value: number } | null;
  };
  const rows = (products.data ?? []) as unknown as P[];
  const instrumentIds = [
    ...new Set(rows.map((p) => p.instrument_id).filter((x): x is string => !!x)),
  ];

  // Journal trades of the day on those instruments, with platform fills if any.
  const journal = instrumentIds.length
    ? await supabase
        .from("trade_facts")
        .select(
          "id, instrument_id, direction, contracts, entry_price, exit_price, entry_at, gross_pnl, time_estimated",
        )
        .eq("trade_date", tradeDate)
        .eq("kind", "taken")
        .in("instrument_id", instrumentIds)
        .order("entry_at")
    : { data: [], error: null };
  if (journal.error) throw journal.error;
  const journalIds = (journal.data ?? []).map((t) => t.id!);
  const [linked, platform] = journalIds.length
    ? await Promise.all([
        supabase
          .from("statement_trades")
          .select("trade_id")
          .in("trade_id", journalIds)
          .is("deleted_at", null),
        supabase
          .from("fills")
          .select("trade_id, side, qty, price")
          .in("trade_id", journalIds)
          .is("deleted_at", null),
      ])
    : [
        { data: [] as { trade_id: string | null }[], error: null },
        {
          data: [] as { trade_id: string | null; side: string; qty: number; price: number }[],
          error: null,
        },
      ];
  if (linked.error) throw linked.error;
  if (platform.error) throw platform.error;
  const linkedIds = new Set((linked.data ?? []).map((l) => l.trade_id));
  const platformBy = new Map<string, { side: Side; qty: number; price: number }[]>();
  for (const f of platform.data ?? []) {
    if (!f.trade_id) continue;
    const list = platformBy.get(f.trade_id) ?? [];
    list.push({ side: f.side as Side, qty: Number(f.qty), price: Number(f.price) });
    platformBy.set(f.trade_id, list);
  }

  type B = {
    id: string;
    seq: number;
    origin: "created" | "linked";
    method: string;
    product_id: string;
    direction: Direction;
    contracts: number;
    avg_buy: number;
    avg_sell: number;
    gross_pnl: number;
    fees: number;
    time_estimated: boolean;
    trade_id: string | null;
    allocations: { fill_id: string; qty: number; deleted_at: string | null }[];
    trade: {
      deleted_at: string | null;
      needs_review: boolean;
      primary_domain: string | null;
    } | null;
  };
  const builtRows = (built.data ?? []) as unknown as B[];

  return rows.map((p) => {
    const scale = Number(p.price_scale);
    return {
      productId: p.id,
      code: p.code,
      contract: p.contract,
      description: p.description,
      symbol: p.instrument?.symbol ?? null,
      instrumentId: p.instrument_id,
      tickSize: p.instrument ? Number(p.instrument.tick_size) : null,
      tickValue: p.instrument ? Number(p.instrument.tick_value) : null,
      priceScale: scale,
      realized: p.realized_pnl === null ? null : Number(p.realized_pnl),
      fills: fills.rows
        .filter((f) => f.code === p.code && f.contract === p.contract)
        .map((f) => ({
          id: f.id,
          side: f.side as Side,
          qty: f.qty,
          price: f.price === null ? Number.NaN : Number(f.price) * scale,
          priceText: f.price_text,
        })),
      built: builtRows
        .filter((b) => b.product_id === p.id)
        .map((b) => ({
          id: b.id,
          seq: b.seq,
          origin: b.origin,
          method: b.method,
          direction: b.direction,
          contracts: b.contracts,
          avgBuy: Number(b.avg_buy),
          avgSell: Number(b.avg_sell),
          gross: Number(b.gross_pnl),
          fees: Number(b.fees),
          timeEstimated: b.time_estimated,
          tradeId: b.trade_id,
          tradeMissing: !b.trade || b.trade.deleted_at !== null,
          reviewed: !!b.trade && (!b.trade.needs_review || !!b.trade.primary_domain),
          allocations: b.allocations
            .filter((a) => a.deleted_at === null)
            .map((a) => ({ fillId: a.fill_id, qty: a.qty })),
        })),
      journal: (journal.data ?? [])
        .filter(
          (t) =>
            t.instrument_id === p.instrument_id &&
            !linkedIds.has(t.id!) &&
            t.contracts !== null &&
            Number.isInteger(Number(t.contracts)),
        )
        .map((t) => ({
          id: t.id!,
          direction: t.direction as Direction,
          contracts: Number(t.contracts),
          entryPrice: Number(t.entry_price),
          exitPrice: t.exit_price === null ? null : Number(t.exit_price),
          entryAt: t.entry_at!,
          gross: t.gross_pnl === null ? null : Number(t.gross_pnl),
          timeEstimated: !!t.time_estimated,
          fills: platformBy.get(t.id!),
        })),
    };
  });
}

export type UnsplitDay = { id: string; tradeDate: string; products: number };

/**
 * Recent statements with products (mapped, with fills) not split into trades
 * yet, newest first.
 */
export async function loadUnsplitDays(from: string | null): Promise<UnsplitDay[]> {
  const supabase = await createClient();
  const [products, built] = await Promise.all([
    fetchAll((a, b) => {
      let q = supabase
        .from("statement_products")
        .select(
          "id, statement_id, long_qty, instrument_id, statement:statements!inner(trade_date, deleted_at)",
        )
        .is("statement.deleted_at", null)
        .gt("long_qty", 0)
        .not("instrument_id", "is", null);
      if (from) q = q.gte("trade_date", from);
      return q.order("id").range(a, b);
    }, 20000),
    fetchAll((a, b) => {
      let q = supabase.from("statement_trades").select("product_id").is("deleted_at", null);
      if (from) q = q.gte("created_at", `${from}T00:00:00Z`);
      return q.order("id").range(a, b);
    }, 50000),
  ]);
  const done = new Set(built.rows.map((b) => b.product_id));
  const byStatement = new Map<string, UnsplitDay>();
  for (const p of products.rows as unknown as {
    id: string;
    statement_id: string;
    statement: { trade_date: string };
  }[]) {
    if (done.has(p.id)) continue;
    const d = byStatement.get(p.statement_id) ?? {
      id: p.statement_id,
      tradeDate: p.statement.trade_date,
      products: 0,
    };
    d.products++;
    byStatement.set(p.statement_id, d);
  }
  return [...byStatement.values()].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}
