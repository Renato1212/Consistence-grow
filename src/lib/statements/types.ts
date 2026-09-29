/** One positioned text run from a PDF page (PDF user space: y grows upwards). */
export type TextItem = { str: string; x: number; y: number; w: number };
export type PdfPage = { items: TextItem[] };

export type Side = "buy" | "sell";

export type StatementFill = {
  section: "confirmation" | "purchase";
  seq: number;
  tradeDate: string; // YYYY-MM-DD
  code: string; // broker product code, e.g. "MS"
  contract: string; // delivery, e.g. "DEC-26"
  exchange: string; // e.g. "CME"
  description: string; // e.g. "MICRO S&P"
  side: Side;
  qty: number;
  priceText: string; // as printed, e.g. "104'115"
  price: number | null;
  type: string; // e.g. "FUT-T-T"
  currency: string;
  /** Purchase & sale only: signed cash amount (buys negative). */
  amount: number | null;
};

export type StatementProduct = {
  code: string;
  contract: string;
  exchange: string;
  description: string;
  currency: string;
  longQty: number;
  shortQty: number;
  fills: number;
  /** Printed "Total" line (long, short), when found. */
  statedLong: number | null;
  statedShort: number | null;
  /** Printed "Realized P/L" of the purchase & sale group. */
  realizedPnl: number | null;
  /** Sum of the purchase & sale amounts. */
  amountSum: number | null;
  avgBuy: number | null;
  avgSell: number | null;
};

export type SummaryKey =
  | "openCash"
  | "cashEntries"
  | "fxTrades"
  | "optionPremium"
  | "netEquityTrade"
  | "realizedPnl"
  | "fxRealizedPnl"
  | "clrCommission"
  | "marketFees"
  | "nfaFees"
  | "miscFees"
  | "totalFees"
  | "totalCharge"
  | "closeCash"
  | "openTradeEquity"
  | "fxOpenTradeEquity"
  | "totalEquity"
  | "equityPortfolioValue"
  | "netOptionMarketValue"
  | "netLiquidValue"
  | "initialMargin"
  | "maintenanceMargin"
  | "excess"
  | "mtdCashEntries"
  | "mtdRealizedPnl"
  | "mtdClrCommissions"
  | "mtdMarket"
  | "mtdNfa"
  | "mtdMisc"
  | "mtdFees";

export type NlvPoint = { offset: number; nlv: number; change: number | null };

export type ParsedStatement = {
  format: "axia-daily-detail";
  parserVersion: number;
  tradeDate: string;
  client: string;
  account: string;
  /** Top-right label, e.g. "Axia Pro Trial". */
  program: string | null;
  simulated: boolean;
  currency: string;
  /** Summary values in the account currency (first column). */
  summary: Partial<Record<SummaryKey, number>>;
  /** Every summary row as printed: label → [account currency, base currency]. */
  summaryRows: Record<string, [number | null, number | null]>;
  nlvHistory: NlvPoint[];
  fills: StatementFill[];
  products: StatementProduct[];
  /** Grand "Total" of the purchase & sale section. */
  psTotal: number | null;
  /** Lines the parser did not understand (never silently dropped). */
  unparsed: string[];
};

export type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  /** Warnings are shown but do not flag the statement. */
  severity: "error" | "warning";
  detail?: string;
};
