import "server-only";

import {
  reconSummary,
  reconcile,
  type DayContext,
  type DayProduct,
  type JournalTrade,
  type StatementDay,
} from "@/lib/statements/analysis";
import type { CheckResult, NlvPoint } from "@/lib/statements/types";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";

import { fetchAll } from "./paginate";

export const STATEMENT_RANGES = ["30", "90", "ytd", "all"] as const;
export type StatementRange = (typeof STATEMENT_RANGES)[number];

export function parseRange(raw: string | string[] | undefined): StatementRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (STATEMENT_RANGES as readonly string[]).includes(v ?? "") ? (v as StatementRange) : "all";
}

export function rangeStart(range: StatementRange, today: string): string | null {
  if (range === "all") return null;
  if (range === "ytd") return `${today.slice(0, 4)}-01-01`;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(range));
  return d.toISOString().slice(0, 10);
}

type ProductRow = {
  code: string;
  contract: string;
  description: string;
  instrument_id: string | null;
  price_scale: number;
  implied_multiplier: number | null;
  long_qty: number;
  short_qty: number;
  fills: number;
  realized_pnl: number | null;
  instrument: { symbol: string; tick_size: number; tick_value: number } | null;
};

const PRODUCT_SELECT =
  "code, contract, description, instrument_id, price_scale, implied_multiplier, long_qty, short_qty, fills, realized_pnl, instrument:instruments(symbol, tick_size, tick_value)";

export function toDayProduct(p: ProductRow): DayProduct {
  return {
    code: p.code,
    contract: p.contract,
    description: p.description,
    instrumentId: p.instrument_id,
    symbol: p.instrument?.symbol ?? null,
    tickSize: p.instrument ? Number(p.instrument.tick_size) : null,
    tickValue: p.instrument ? Number(p.instrument.tick_value) : null,
    priceScale: Number(p.price_scale),
    impliedMultiplier: p.implied_multiplier === null ? null : Number(p.implied_multiplier),
    longQty: p.long_qty,
    shortQty: p.short_qty,
    fills: p.fills,
    realized: p.realized_pnl === null ? null : Number(p.realized_pnl),
  };
}

export async function loadAccounts(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statements")
    .select("account, trade_date")
    .is("deleted_at", null)
    .order("trade_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.account))];
}

/** Active statements (with products) of one account, oldest first. */
export async function loadStatementDays(opts: {
  account?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<StatementDay[]> {
  const supabase = await createClient();
  const { rows } = await fetchAll((from, to) => {
    let q = supabase
      .from("statements")
      .select(
        `id, account, trade_date, realized_pnl, total_fees, net_pnl, net_liquid_value, contracts, fills, status, simulated, nlv_history, products:statement_products(${PRODUCT_SELECT})`,
      )
      .is("deleted_at", null);
    if (opts.account) q = q.eq("account", opts.account);
    if (opts.from) q = q.gte("trade_date", opts.from);
    if (opts.to) q = q.lte("trade_date", opts.to);
    return q.order("trade_date").order("id").range(from, to);
  }, 5000);
  return rows.map((s) => ({
    id: s.id,
    account: s.account,
    tradeDate: s.trade_date,
    realized: Number(s.realized_pnl),
    fees: Number(s.total_fees),
    net: Number(s.net_pnl),
    nlv: s.net_liquid_value === null ? null : Number(s.net_liquid_value),
    contracts: s.contracts,
    fills: s.fills,
    status: s.status as StatementDay["status"],
    simulated: s.simulated,
    nlvHistory: (s.nlv_history ?? []) as NlvPoint[],
    products: ((s.products ?? []) as unknown as ProductRow[]).map(toDayProduct),
  }));
}

/** Taken trades on the given trading days (for reconciliation). */
export async function loadJournalTrades(dates: string[]): Promise<JournalTrade[]> {
  if (!dates.length) return [];
  const sorted = dates.toSorted();
  const supabase = await createClient();
  const { rows } = await fetchAll(
    (from, to) =>
      supabase
        .from("trade_facts")
        .select("id, trade_date, instrument_id, symbol, gross_pnl, contracts")
        .eq("kind", "taken")
        .is("deleted_at", null)
        .gte("trade_date", sorted[0])
        .lte("trade_date", sorted.at(-1)!)
        .order("trade_date")
        .order("id")
        .range(from, to),
    20000,
  );
  const wanted = new Set(dates);
  return rows
    .filter((t) => t.id && t.instrument_id && t.trade_date && wanted.has(t.trade_date))
    .map((t) => ({
      id: t.id!,
      tradingDay: t.trade_date!,
      instrumentId: t.instrument_id!,
      symbol: t.symbol ?? "?",
      grossPnl: t.gross_pnl === null ? null : Number(t.gross_pnl),
      contracts: Number(t.contracts ?? 0),
    }));
}

/** Prep, readiness, debrief rules/grade and high-impact events per date. */
export async function loadDayContext(from: string, to: string): Promise<Map<string, DayContext>> {
  const supabase = await createClient();
  const [days, events] = await Promise.all([
    supabase
      .from("trading_days")
      .select(
        "date, session_preps(completed_at, sleep, energy, focus, deleted_at), debriefs(grade_process, deleted_at), rule_checks(context, followed, deleted_at)",
      )
      .gte("date", from)
      .lte("date", to)
      .is("deleted_at", null)
      .limit(5000),
    supabase
      .from("calendar_events")
      .select("starts_at")
      .eq("importance", 3)
      .is("deleted_at", null)
      .gte("starts_at", `${from}T00:00:00Z`)
      .lte("starts_at", `${to}T23:59:59Z`)
      .limit(5000),
  ]);
  if (days.error) throw days.error;
  if (events.error) throw events.error;
  const eventDates = new Set(
    (events.data ?? []).map((e) => formatInTz(new Date(e.starts_at), DISPLAY_TZ, "yyyy-MM-dd")),
  );
  const out = new Map<string, DayContext>();
  type Prep = {
    completed_at: string | null;
    sleep: number | null;
    energy: number | null;
    focus: number | null;
    deleted_at: string | null;
  };
  type Debrief = { grade_process: string | null; deleted_at: string | null };
  type Check = { context: string; followed: boolean | null; deleted_at: string | null };
  for (const d of days.data ?? []) {
    const preps = ((d.session_preps ?? []) as Prep[]).filter((p) => !p.deleted_at);
    const scores = preps
      .map((p) => [p.sleep, p.energy, p.focus].filter((v): v is number => v !== null))
      .filter((v) => v.length)
      .map((v) => v.reduce((a, b) => a + b, 0) / v.length);
    const debriefRaw = (d.debriefs ?? null) as Debrief | Debrief[] | null;
    const debrief = (Array.isArray(debriefRaw) ? debriefRaw[0] : debriefRaw) ?? null;
    const checks = ((d.rule_checks ?? []) as Check[]).filter(
      (c) => !c.deleted_at && c.context === "debrief" && c.followed !== null,
    );
    out.set(d.date, {
      prepDone: preps.some((p) => p.completed_at),
      readiness: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      rulesFollowed: checks.length ? checks.filter((c) => c.followed).length / checks.length : null,
      processGrade:
        debrief && !debrief.deleted_at
          ? (debrief.grade_process as DayContext["processGrade"])
          : null,
      highImpactEvent: eventDates.has(d.date),
    });
  }
  for (const date of eventDates) {
    if (!out.has(date))
      out.set(date, {
        prepDone: false,
        readiness: null,
        rulesFollowed: null,
        processGrade: null,
        highImpactEvent: true,
      });
  }
  return out;
}

export type StatementDetail = {
  id: string;
  account: string;
  clientCode: string;
  tradeDate: string;
  program: string | null;
  simulated: boolean;
  currency: string;
  status: "ok" | "attention";
  source: string;
  realized: number;
  fees: number;
  net: number;
  summaryRows: Record<string, [number | null, number | null]>;
  nlvHistory: NlvPoint[];
  checks: CheckResult[];
  unparsed: string[];
  fileName: string | null;
  pdfUrl: string | null;
  createdAt: string;
  products: (DayProduct & {
    avgBuy: number | null;
    avgSell: number | null;
    exchange: string;
  })[];
  fills: {
    section: string;
    seq: number;
    tradeDate: string;
    code: string;
    contract: string;
    side: string;
    qty: number;
    priceText: string;
    amount: number | null;
  }[];
};

export async function loadStatement(id: string): Promise<StatementDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statements")
    .select(
      `id, account, client_code, trade_date, program, simulated, currency, status, source, realized_pnl, total_fees, net_pnl, summary_rows, nlv_history, checks, unparsed, file_name, file_path, created_at, products:statement_products(${PRODUCT_SELECT}, avg_buy, avg_sell, exchange)`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const fills = await fetchAll(
    (from, to) =>
      supabase
        .from("statement_fills")
        .select("section, seq, trade_date, code, contract, side, qty, price_text, amount")
        .eq("statement_id", id)
        .order("seq")
        .range(from, to),
    20000,
  );
  const signed = data.file_path
    ? await supabase.storage.from("statements").createSignedUrl(data.file_path, 3600)
    : null;
  type Extra = ProductRow & { avg_buy: number | null; avg_sell: number | null; exchange: string };
  return {
    id: data.id,
    account: data.account,
    clientCode: data.client_code,
    tradeDate: data.trade_date,
    program: data.program,
    simulated: data.simulated,
    currency: data.currency,
    status: data.status as StatementDetail["status"],
    source: data.source,
    realized: Number(data.realized_pnl),
    fees: Number(data.total_fees),
    net: Number(data.net_pnl),
    summaryRows: (data.summary_rows ?? {}) as StatementDetail["summaryRows"],
    nlvHistory: (data.nlv_history ?? []) as NlvPoint[],
    checks: (data.checks ?? []) as CheckResult[],
    unparsed: (data.unparsed ?? []) as string[],
    fileName: data.file_name,
    pdfUrl: signed?.data?.signedUrl ?? null,
    createdAt: data.created_at,
    products: ((data.products ?? []) as unknown as Extra[]).map((p) => ({
      ...toDayProduct(p),
      avgBuy: p.avg_buy === null ? null : Number(p.avg_buy),
      avgSell: p.avg_sell === null ? null : Number(p.avg_sell),
      exchange: p.exchange,
    })),
    fills: fills.rows.map((f) => ({
      section: f.section,
      seq: f.seq,
      tradeDate: f.trade_date,
      code: f.code,
      contract: f.contract,
      side: f.side,
      qty: f.qty,
      priceText: f.price_text,
      amount: f.amount === null ? null : Number(f.amount),
    })),
  };
}

export type CodeMapRow = {
  code: string;
  description: string;
  lastSeen: string;
  statements: number;
  instrumentId: string | null;
  symbol: string | null;
  defaultSymbol: string | null;
  priceScale: number;
  mapped: boolean; // the owner's own mapping
  mappingOk: boolean | null;
};

/** Every product code seen in statements, with its current mapping. */
export async function loadCodeMap(): Promise<{
  rows: CodeMapRow[];
  instruments: { id: string; symbol: string; name: string }[];
}> {
  const supabase = await createClient();
  const [products, map, instruments] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("statement_products")
          .select(
            "code, description, trade_date, default_symbol, price_scale, implied_multiplier, instrument_id, instrument:instruments(symbol, tick_size, tick_value), statement:statements!inner(deleted_at)",
          )
          .is("statement.deleted_at", null)
          .order("trade_date", { ascending: false })
          .order("id")
          .range(from, to),
      20000,
    ),
    supabase.from("statement_code_map").select("code").is("deleted_at", null),
    supabase
      .from("instruments")
      .select("id, symbol, name")
      .is("deleted_at", null)
      .order("sort_order"),
  ]);
  if (map.error) throw map.error;
  if (instruments.error) throw instruments.error;
  const own = new Set((map.data ?? []).map((m) => m.code));
  const byCode = new Map<string, CodeMapRow>();
  for (const p of products.rows) {
    const inst = p.instrument as unknown as {
      symbol: string;
      tick_size: number;
      tick_value: number;
    } | null;
    const existing = byCode.get(p.code);
    const expected = inst
      ? (Number(inst.tick_value) / Number(inst.tick_size)) * Number(p.price_scale)
      : null;
    const ok =
      expected && p.implied_multiplier !== null
        ? Math.abs(Number(p.implied_multiplier) - expected) / expected < 0.005
        : null;
    if (existing) {
      existing.statements += 1;
      if (ok === false) existing.mappingOk = false;
      continue;
    }
    byCode.set(p.code, {
      code: p.code,
      description: p.description,
      lastSeen: p.trade_date,
      statements: 1,
      instrumentId: p.instrument_id,
      symbol: inst?.symbol ?? null,
      defaultSymbol: p.default_symbol,
      priceScale: Number(p.price_scale),
      mapped: own.has(p.code),
      mappingOk: ok,
    });
  }
  return {
    rows: [...byCode.values()].toSorted((a, b) => a.code.localeCompare(b.code)),
    instruments: instruments.data ?? [],
  };
}

export type StatementNudge = {
  open: number;
  missingDate: string | null;
  completeness: number | null;
};

/**
 * Today's statement nudges (only once statements are in use): broker
 * product-days of the last 14 days that don't match the journal, and the most
 * recent past trading day with journal trades but no statement.
 */
export async function loadStatementNudge(today: string): Promise<StatementNudge | null> {
  const supabase = await createClient();
  const any = await supabase
    .from("statements")
    .select("id", { head: true, count: "exact" })
    .is("deleted_at", null);
  if (!any.count) return null;
  const from = rangeStart("30", today)!;
  const recentFrom = new Date(`${today}T12:00:00Z`);
  recentFrom.setUTCDate(recentFrom.getUTCDate() - 14);
  const days = await loadStatementDays({ from: recentFrom.toISOString().slice(0, 10) });
  const [trades, traded] = await Promise.all([
    loadJournalTrades(days.map((d) => d.tradeDate)),
    supabase
      .from("trade_facts")
      .select("trade_date")
      .eq("kind", "taken")
      .is("deleted_at", null)
      .gte("trade_date", from)
      .lt("trade_date", today)
      .order("trade_date", { ascending: false })
      .limit(200),
  ]);
  const summary = reconSummary(reconcile(days, trades));
  const withStatement = new Set(
    (
      await supabase
        .from("statements")
        .select("trade_date")
        .is("deleted_at", null)
        .gte("trade_date", from)
    ).data?.map((s) => s.trade_date) ?? [],
  );
  const missingDate =
    (traded.data ?? [])
      .map((t) => t.trade_date)
      .find((d): d is string => !!d && !withStatement.has(d)) ?? null;
  return {
    open: summary.differs + summary.missing + summary.unmapped,
    missingDate,
    completeness: summary.completeness,
  };
}
