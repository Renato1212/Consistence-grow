/**
 * Parser for the Axia (Axia Pro Trial / Axia Futures) "Daily Detail
 * Statement" PDF, from positioned text lines. It reads the header, the
 * financial summary, the last-5 NLV block, the future confirmations (the
 * day's fills) and the purchase & sale section (matched fills with cash
 * amounts and realized P/L per product). Anything it does not recognise goes
 * to `unparsed` instead of being dropped.
 */
import { parseTreasuryPrice } from "@/lib/trading/treasury";

import { toLines, type Cell, type Line } from "./layout";
import type {
  NlvPoint,
  ParsedStatement,
  PdfPage,
  StatementFill,
  StatementProduct,
  SummaryKey,
} from "./types";

export const AXIA_PARSER_VERSION = 1;

export class StatementFormatError extends Error {}

const SUMMARY_KEYS: Record<string, SummaryKey> = {
  opencashbalance: "openCash",
  cashentries: "cashEntries",
  fxtrades: "fxTrades",
  optionpremium: "optionPremium",
  netequitytrade: "netEquityTrade",
  realizedpl: "realizedPnl",
  fxrealizedpl: "fxRealizedPnl",
  clrcommission: "clrCommission",
  marketfees: "marketFees",
  nfafees: "nfaFees",
  miscfees: "miscFees",
  totalfees: "totalFees",
  totalcharge: "totalCharge",
  closecashbalance: "closeCash",
  opentradeequity: "openTradeEquity",
  fxopentradeequity: "fxOpenTradeEquity",
  totalequity: "totalEquity",
  equityportfoliovalue: "equityPortfolioValue",
  netoptionmarketvalue: "netOptionMarketValue",
  netliquidvalue: "netLiquidValue",
  initialmargin: "initialMargin",
  maintenancemargin: "maintenanceMargin",
  excessshortage: "excess",
  mtdcashentries: "mtdCashEntries",
  mtdrealizedpl: "mtdRealizedPnl",
  mtdclrcommissions: "mtdClrCommissions",
  mtdmarket: "mtdMarket",
  mtdnfa: "mtdNfa",
  mtdmisc: "mtdMisc",
  mtdttlcommfees: "mtdFees",
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "28-Sep-2026" or "Monday, 28 Sep 2026" → "2026-09-28". */
export function parseStatementDate(raw: string): string | null {
  const m = /(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/.exec(raw.trim());
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  const d = Number(m[1]);
  const y = Number(m[3]);
  if (!mo || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** "-46,726.00", "1", "(1,234.50)" → number; anything else → null. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  const paren = /^\((\d*\.?\d+)\)$/.exec(s);
  if (paren) return -Number(paren[1]);
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

/** Decimal prices, or treasury 32nds as printed ("104'115"). */
export function parseStatementPrice(raw: string): number | null {
  const s = raw.trim();
  if (/['\s+]|\d-\d/.test(s)) {
    const r = parseTreasuryPrice(s);
    return r.ok ? r.value : null;
  }
  const n = parseAmount(s);
  return n !== null && n > 0 ? n : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isNumber = (c: Cell) => parseAmount(c.text) !== null;
const DATE_CELL = /^\d{1,2}-[A-Za-z]{3}-\d{4}$/;
const PRODUCT_START = /^\S+\s*:\s*[A-Z]{3}-\d{2}\b/;
const PRODUCT_CELL = /^(\S+)\s*:\s*([A-Z]{3}-\d{2})\s+(\S+)\s+(.+)$/;
const IGNORE = [
  /^CHG NLV$/i,
  /^PLEASE CHECK ACCURACY/i,
  /^Page \d+$/i,
  /^NO RECAP OF /i,
  /^NO .* ACTIVITY$/i,
];
const KNOWN_SECTIONS = ["FINANCIAL SUMMARY", "FUTURE CONFIRMATIONS", "PURCHASE & SALE"] as const;
type Section = (typeof KNOWN_SECTIONS)[number] | "UNKNOWN";

function isSectionTitle(line: Line): boolean {
  return (
    line.cells.length === 1 &&
    line.cells[0].x > 150 &&
    /^[A-Z][A-Z &/'-]{3,}$/.test(line.cells[0].text) &&
    !IGNORE.some((r) => r.test(line.text))
  );
}

const isColumnHeader = (line: Line) =>
  line.cells[0]?.text === "Trade Date" && line.cells.some((c) => c.text === "Long");

const isHeaderField = (line: Line) =>
  line.cells.length >= 2 &&
  line.cells[1].text === ":" &&
  ["Report", "Trade Date", "Client", "Account"].includes(line.cells[0].text);

type Columns = { longRight: number; shortRight: number };
type Total = { section: "confirmation" | "purchase"; key: string; long: number; short: number };

export type AxiaParse = ParsedStatement & { totals: Total[] };

export function parseAxiaStatement(pages: PdfPage[]): AxiaParse {
  const lines = toLines(pages);
  const header = new Map<string, string>();
  for (const line of lines.filter(isHeaderField)) {
    if (!header.has(line.cells[0].text))
      header.set(
        line.cells[0].text,
        line.cells
          .slice(2)
          .map((c) => c.text)
          .join(" "),
      );
  }
  if (!/daily detail statement/i.test(header.get("Report") ?? ""))
    throw new StatementFormatError("This is not an Axia “Daily Detail Statement”.");
  const tradeDate = parseStatementDate(header.get("Trade Date") ?? "");
  const client = header.get("Client")?.trim();
  const account = header.get("Account")?.trim();
  if (!tradeDate || !client || !account)
    throw new StatementFormatError(
      "The statement header (trade date, client, account) is unreadable.",
    );

  let program: string | null = null;
  let simulated = false;
  const summaryRows: ParsedStatement["summaryRows"] = {};
  const summary: ParsedStatement["summary"] = {};
  const nlvHistory: NlvPoint[] = [];
  const fills: StatementFill[] = [];
  const totals: Total[] = [];
  const realized = new Map<string, number>();
  const unparsed: string[] = [];
  let psTotal: number | null = null;
  let currency = "USD";

  let section: Section | null = null;
  let columns: Columns | null = null;
  let inNlv = false;
  const lastKey: Record<"confirmation" | "purchase", string | null> = {
    confirmation: null,
    purchase: null,
  };
  let seq = 0;
  let page = 0;
  let inPageHeader = true;

  const sideOf = (cell: Cell): "long" | "short" => {
    if (!columns) return "long";
    return Math.abs(cell.right - columns.longRight) <= Math.abs(cell.right - columns.shortRight)
      ? "long"
      : "short";
  };

  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      inPageHeader = true;
      inNlv = false;
    }
    if (IGNORE.some((r) => r.test(line.text))) continue;
    if (isHeaderField(line)) continue;
    if (isSectionTitle(line)) {
      inPageHeader = false;
      const title = line.cells[0].text;
      section = (KNOWN_SECTIONS as readonly string[]).includes(title)
        ? (title as Section)
        : "UNKNOWN";
      if (section === "UNKNOWN") unparsed.push(`Section “${title}” is not supported yet`);
      inNlv = false;
      continue;
    }
    if (isColumnHeader(line)) {
      inPageHeader = false;
      const long = line.cells.find((c) => c.text === "Long")!;
      const short = line.cells.find((c) => c.text === "Short");
      columns = { longRight: long.right, shortRight: short?.right ?? long.right + 30 };
      continue;
    }
    if (inPageHeader) {
      // Holder name (left) and program / simulation notice (right).
      if (page === 1) {
        const right = line.cells.filter((c) => c.x > 250).map((c) => c.text);
        if (right.some((t) => /simulated|does not reflect real money/i.test(t))) simulated = true;
        else if (right.length && !program) program = right.join(" ");
      }
      continue;
    }

    if (section === "FINANCIAL SUMMARY") {
      if (/^Last \d+ NLV Values/i.test(line.text)) {
        inNlv = true;
        continue;
      }
      if (inNlv) {
        const tag = /^T(?:\s*-\s*(\d+))?$/.exec(line.cells[0].text);
        const nums = line.cells.filter(isNumber).map((c) => parseAmount(c.text)!);
        if (tag && nums.length >= 1) {
          nlvHistory.push({
            offset: tag[1] ? -Number(tag[1]) : 0,
            nlv: nums[0],
            change: nums[1] ?? null,
          });
        } else unparsed.push(line.text);
        continue;
      }
      const labelCells = line.cells.filter((c) => !isNumber(c));
      const numCells = line.cells.filter(isNumber);
      const label = labelCells.map((c) => c.text).join(" ");
      if (!numCells.length) {
        const cur = /^([A-Z]{3})\s+BASE\s+[A-Z]{3}$/.exec(label);
        if (cur) currency = cur[1];
        else unparsed.push(line.text);
        continue;
      }
      const values: [number | null, number | null] = [
        parseAmount(numCells[0].text),
        numCells[1] ? parseAmount(numCells[1].text) : null,
      ];
      summaryRows[label] = values;
      const key = SUMMARY_KEYS[norm(label)];
      if (key && values[0] !== null) summary[key] = values[0];
      continue;
    }

    if (section === "FUTURE CONFIRMATIONS" || section === "PURCHASE & SALE") {
      const kind = section === "FUTURE CONFIRMATIONS" ? "confirmation" : "purchase";
      const first = line.cells[0];
      if (first.text === "Total") {
        const nums = line.cells.slice(1).filter(isNumber);
        if (first.x > 300) {
          // Grand total of the purchase & sale section.
          psTotal = nums.length ? parseAmount(nums.at(-1)!.text) : null;
          continue;
        }
        const key = lastKey[kind];
        if (!key) {
          unparsed.push(line.text);
          continue;
        }
        const pnlIdx = line.cells.findIndex((c) => /^Realized P\/L$/i.test(c.text));
        const qtyCells = (pnlIdx >= 0 ? line.cells.slice(1, pnlIdx) : line.cells.slice(1)).filter(
          isNumber,
        );
        const t: Total = { section: kind, key, long: 0, short: 0 };
        for (const c of qtyCells) t[sideOf(c)] = parseAmount(c.text)!;
        totals.push(t);
        if (pnlIdx >= 0) {
          const v = line.cells.slice(pnlIdx + 1).find(isNumber);
          if (v) realized.set(key, parseAmount(v.text)!);
        }
        continue;
      }
      if (DATE_CELL.test(first.text)) {
        const fill = parseFillLine(line, kind, sideOf);
        if (!fill) {
          unparsed.push(line.text);
          lastKey[kind] = null; // never attach a following Total to the wrong product
          continue;
        }
        fills.push({ ...fill, seq: seq++ });
        lastKey[kind] = `${fill.code}|${fill.contract}`;
        continue;
      }
      unparsed.push(line.text);
      continue;
    }

    unparsed.push(line.text);
  }

  const products = buildProducts(fills, realized, totals);
  return {
    format: "axia-daily-detail",
    parserVersion: AXIA_PARSER_VERSION,
    tradeDate,
    client,
    account,
    program,
    simulated,
    currency,
    summary,
    summaryRows,
    nlvHistory: nlvHistory.toSorted((a, b) => a.offset - b.offset),
    fills,
    products,
    psTotal,
    unparsed,
    totals,
  };
}

function parseFillLine(
  line: Line,
  section: "confirmation" | "purchase",
  sideOf: (c: Cell) => "long" | "short",
): Omit<StatementFill, "seq"> | null {
  const [dateCell, ...rest] = line.cells;
  const tradeDate = parseStatementDate(dateCell.text);
  const productIdx = rest.findIndex((c) => PRODUCT_START.test(c.text));
  const typeIdx = rest.findIndex((c) => /^[A-Z]{2,4}(-[A-Z]+)+$/.test(c.text));
  if (!tradeDate || productIdx < 1 || typeIdx < productIdx + 2) return null;
  const qtyCells = rest.slice(0, productIdx).filter(isNumber);
  if (qtyCells.length !== 1) return null;
  const qty = parseAmount(qtyCells[0].text)!;
  if (!(qty > 0) || !Number.isInteger(qty)) return null;
  // The product may be split into several runs ("EF : NOV-26" + "NYM MICR CRUDE").
  const productText = rest
    .slice(productIdx, typeIdx - 1)
    .map((c) => c.text)
    .join(" ");
  const pm = PRODUCT_CELL.exec(productText);
  if (!pm) return null;
  const type = rest[typeIdx].text;
  if (!type.startsWith("FUT")) return null; // options and other types are not supported yet
  const priceText = rest[typeIdx - 1].text;
  const price = parseStatementPrice(priceText);
  if (price === null) return null;
  const tail = rest.slice(typeIdx + 1);
  const cur = tail.find((c) => /^[A-Z]{3}$/.test(c.text))?.text ?? "USD";
  const amountCell = tail.find(isNumber);
  const amount = amountCell ? parseAmount(amountCell.text) : null;
  if (section === "purchase" && amount === null) return null;
  return {
    section,
    tradeDate,
    code: pm[1],
    contract: pm[2],
    exchange: pm[3],
    description: pm[4].replace(/\s+/g, " ").trim(),
    side: sideOf(qtyCells[0]) === "long" ? "buy" : "sell",
    qty,
    priceText,
    price,
    type,
    currency: cur,
    amount,
  };
}

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

function buildProducts(
  fills: StatementFill[],
  realized: Map<string, number>,
  totals: Total[],
): StatementProduct[] {
  const keys = [...new Set(fills.map((f) => `${f.code}|${f.contract}`))];
  return keys.map((key) => {
    const mine = fills.filter((f) => `${f.code}|${f.contract}` === key);
    const conf = mine.filter((f) => f.section === "confirmation");
    const ps = mine.filter((f) => f.section === "purchase");
    const activity = conf.length ? conf : ps.filter((f) => f.tradeDate === mine[0].tradeDate);
    const buys = activity.filter((f) => f.side === "buy");
    const sells = activity.filter((f) => f.side === "sell");
    const qty = (xs: StatementFill[]) => xs.reduce((s, f) => s + f.qty, 0);
    const avg = (xs: StatementFill[]) =>
      xs.length ? round(xs.reduce((s, f) => s + f.qty * (f.price ?? 0), 0) / qty(xs), 6) : null;
    const stated = totals.find((t) => t.key === key && t.section === "confirmation") ??
      totals.find((t) => t.key === key) ?? { long: null, short: null };
    return {
      code: mine[0].code,
      contract: mine[0].contract,
      exchange: mine[0].exchange,
      description: mine[0].description,
      currency: mine[0].currency,
      longQty: qty(buys),
      shortQty: qty(sells),
      fills: activity.length,
      statedLong: stated.long,
      statedShort: stated.short,
      realizedPnl: realized.get(key) ?? null,
      amountSum: ps.length ? round(ps.reduce((s, f) => s + (f.amount ?? 0), 0)) : null,
      avgBuy: avg(buys),
      avgSell: avg(sells),
    };
  });
}
