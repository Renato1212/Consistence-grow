/**
 * PDF bytes → parsed statement + checks + the payload stored by the
 * `save_statement` / `ingest_statement` RPCs. Shared by the upload route, the
 * token endpoint and the tests, so there is exactly one path from file to row.
 */
import { AXIA_PARSER_VERSION, parseAxiaStatement, type AxiaParse } from "./axia";
import { runChecks, statementStatus } from "./checks";
import { extractPages, sha256Hex } from "./extract";
import { toLines } from "./layout";
import { impliedMultiplier, resolveProduct } from "./products";
import type { CheckResult, PdfPage } from "./types";

export type StatementPayload = {
  format: string;
  parser_version: number;
  client_code: string;
  account: string;
  trade_date: string;
  program: string | null;
  simulated: boolean;
  currency: string;
  realized_pnl: number;
  total_fees: number;
  open_cash: number | null;
  close_cash: number | null;
  open_trade_equity: number | null;
  total_equity: number | null;
  net_liquid_value: number | null;
  initial_margin: number | null;
  maintenance_margin: number | null;
  mtd_realized_pnl: number | null;
  mtd_fees: number | null;
  contracts: number;
  fills_count: number;
  summary: AxiaParse["summary"];
  summary_rows: AxiaParse["summaryRows"];
  nlv_history: AxiaParse["nlvHistory"];
  checks: CheckResult[];
  status: "ok" | "attention";
  unparsed: string[];
  file_hash: string;
  file_name: string | null;
  file_path: string | null;
  raw_text: string;
  products: {
    code: string;
    contract: string;
    exchange: string;
    description: string;
    currency: string;
    default_symbol: string | null;
    price_scale: number;
    long_qty: number;
    short_qty: number;
    fills: number;
    realized_pnl: number | null;
    amount_sum: number | null;
    avg_buy: number | null;
    avg_sell: number | null;
    implied_multiplier: number | null;
  }[];
  fills: {
    section: string;
    seq: number;
    trade_date: string;
    code: string;
    contract: string;
    side: string;
    qty: number;
    price_text: string;
    price: number | null;
    type: string;
    currency: string;
    amount: number | null;
  }[];
};

export type PreparedStatement = {
  parsed: AxiaParse;
  checks: CheckResult[];
  payload: StatementPayload;
};

export async function prepareStatement(
  bytes: Uint8Array,
  opts: { fileName?: string | null } = {},
): Promise<PreparedStatement> {
  const pages = await extractPages(bytes);
  return buildPayload(pages, await sha256Hex(bytes), opts.fileName ?? null);
}

export function buildPayload(
  pages: PdfPage[],
  fileHash: string,
  fileName: string | null,
): PreparedStatement {
  const parsed = parseAxiaStatement(pages);
  const checks = runChecks(parsed);
  const s = parsed.summary;
  const rawText = toLines(pages)
    .map((l) => l.text)
    .join("\n")
    .slice(0, 500_000);
  const payload: StatementPayload = {
    format: parsed.format,
    parser_version: AXIA_PARSER_VERSION,
    client_code: parsed.client,
    account: parsed.account,
    trade_date: parsed.tradeDate,
    program: parsed.program,
    simulated: parsed.simulated,
    currency: parsed.currency,
    realized_pnl: s.realizedPnl ?? parsed.psTotal ?? 0,
    total_fees: Math.abs(s.totalCharge ?? s.totalFees ?? 0),
    open_cash: s.openCash ?? null,
    close_cash: s.closeCash ?? null,
    open_trade_equity: s.openTradeEquity ?? null,
    total_equity: s.totalEquity ?? null,
    net_liquid_value: s.netLiquidValue ?? null,
    initial_margin: s.initialMargin ?? null,
    maintenance_margin: s.maintenanceMargin ?? null,
    mtd_realized_pnl: s.mtdRealizedPnl ?? null,
    mtd_fees: s.mtdFees ?? null,
    contracts: parsed.products.reduce((n, p) => n + p.longQty + p.shortQty, 0),
    fills_count: parsed.products.reduce((n, p) => n + p.fills, 0),
    summary: s,
    summary_rows: parsed.summaryRows,
    nlv_history: parsed.nlvHistory,
    checks,
    status: statementStatus(checks),
    unparsed: parsed.unparsed,
    file_hash: fileHash,
    file_name: fileName,
    file_path: null,
    raw_text: rawText,
    products: parsed.products.map((p) => {
      const res = resolveProduct(p);
      const ps = parsed.fills.filter(
        (f) => f.section === "purchase" && f.code === p.code && f.contract === p.contract,
      );
      return {
        code: p.code,
        contract: p.contract,
        exchange: p.exchange,
        description: p.description,
        currency: p.currency,
        default_symbol: res?.symbol ?? null,
        price_scale: res?.priceScale ?? 1,
        long_qty: p.longQty,
        short_qty: p.shortQty,
        fills: p.fills,
        realized_pnl: p.realizedPnl,
        amount_sum: p.amountSum,
        avg_buy: p.avgBuy,
        avg_sell: p.avgSell,
        implied_multiplier: impliedMultiplier(ps),
      };
    }),
    fills: parsed.fills.map((f) => ({
      section: f.section,
      seq: f.seq,
      trade_date: f.tradeDate,
      code: f.code,
      contract: f.contract,
      side: f.side,
      qty: f.qty,
      price_text: f.priceText,
      price: f.price,
      type: f.type,
      currency: f.currency,
      amount: f.amount,
    })),
  };
  return { parsed, checks, payload };
}

/** Storage path of a statement PDF: <user>/<account>/<date>-<hash8>.pdf */
export function statementFilePath(userId: string, p: StatementPayload) {
  const account = p.account.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${userId}/${account}/${p.trade_date}-${p.file_hash.slice(0, 8)}.pdf`;
}
