/**
 * Turn mapped CSV rows into validated fills: timestamps to UTC, prices per the
 * instrument's format, side from text or signed quantity, symbols to the
 * configured instruments. Errors carry the 1-based data row number.
 */
import { zonedWallTimeToUtc } from "@/lib/time";
import { parseTreasuryPrice } from "@/lib/trading/treasury";

export const FILL_FIELDS = [
  "account",
  "symbol",
  "side",
  "qty",
  "price",
  "time",
  "date",
  "fee",
  "orderId",
] as const;
export type FillField = (typeof FILL_FIELDS)[number];

export const REQUIRED_FIELDS: FillField[] = ["symbol", "qty", "price", "time"];

export const DATE_FORMATS = ["auto-iso", "mdy", "dmy", "ymd"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type ImportMapping = {
  /** CSV header for each field (null = not in the file). */
  columns: Partial<Record<FillField, string | null>>;
  dateFormat: DateFormat;
  /** IANA zone the file's timestamps are written in (ignored when they carry an offset). */
  timezone: string;
  decimal: "." | ",";
  /** Raw symbol or root (upper case) → instrument symbol. */
  symbolMap: Record<string, string>;
};

export const DEFAULT_MAPPING: ImportMapping = {
  columns: {},
  dateFormat: "auto-iso",
  timezone: "America/Chicago",
  decimal: ".",
  symbolMap: {},
};

export type ImportInstrument = {
  id: string;
  symbol: string;
  tickSize: number;
  priceFormat: "decimal" | "thirty_seconds";
};

export type Fill = {
  row: number;
  account: string;
  rawSymbol: string;
  instrumentId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  at: string; // ISO UTC
  fee: number | null;
  orderId: string | null;
  raw: Record<string, string>;
};

export type RowError = { row: number; message: string };

/** Guess columns from common header names (Rithmic, MotiveWave, NinjaTrader, Tradovate…). */
export function guessColumns(headers: string[]): ImportMapping["columns"] {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (...names: string[]) => headers.find((h) => names.includes(norm(h))) ?? null;
  return {
    account: find("account", "accountid", "accountname", "acct"),
    symbol: find("symbol", "instrument", "contract", "ticker", "product", "symbolname"),
    side: find("side", "buysell", "bs", "action", "direction", "buysellind"),
    qty: find("qty", "quantity", "filledqty", "fillqty", "size", "filled", "qtyfilled", "volume"),
    price: find("price", "fillprice", "avgprice", "avgfillprice", "executionprice", "filledprice"),
    time: find(
      "time",
      "datetime",
      "timestamp",
      "filltime",
      "executiontime",
      "updatetime",
      "transacttime",
    ),
    date: find("date", "tradedate"),
    fee: find("fee", "fees", "commission", "commissions", "comm"),
    orderId: find("orderid", "order", "orderno", "ordernumber", "fillid", "executionid"),
  };
}

const MONTH = "FGHJKMNQUVXZ";

/**
 * Instrument symbol for a platform symbol: explicit map first (raw, then
 * root), then exact match, then a futures code (root + month letter + year,
 * e.g. ESZ6, ESZ26, 6EZ6, MESH27), searching each token of the raw value.
 */
export function resolveSymbol(
  raw: string,
  instruments: ImportInstrument[],
  symbolMap: Record<string, string> = {},
): ImportInstrument | null {
  const bySymbol = new Map(instruments.map((i) => [i.symbol.toUpperCase(), i]));
  const up = raw.trim().toUpperCase();
  const mapped = symbolMap[up];
  if (mapped) return bySymbol.get(mapped.toUpperCase()) ?? null;
  const tokens = up.split(/[\s.:/@_-]+/).filter(Boolean);
  for (const tok of [up, ...tokens]) {
    if (symbolMap[tok]) return bySymbol.get(symbolMap[tok].toUpperCase()) ?? null;
    if (bySymbol.has(tok)) return bySymbol.get(tok)!;
    const m = new RegExp(`^([A-Z0-9]{1,5}?)([${MONTH}])(\\d{1,4})$`).exec(tok);
    if (m) {
      if (symbolMap[m[1]]) return bySymbol.get(symbolMap[m[1]].toUpperCase()) ?? null;
      if (bySymbol.has(m[1])) return bySymbol.get(m[1])!;
    }
  }
  return null;
}

export function parseNumber(raw: string, decimal: "." | ","): number | null {
  let s = raw
    .trim()
    .replace(/\s/g, "")
    .replace(/[$€£¥]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!s) return null;
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parsePriceFor(
  raw: string,
  inst: ImportInstrument,
  decimal: "." | ",",
): number | null {
  if (inst.priceFormat === "thirty_seconds" && /['\-\s]|\+$/.test(raw.trim())) {
    const r = parseTreasuryPrice(raw.trim(), inst.tickSize);
    return r.ok ? r.value : null;
  }
  const n = parseNumber(raw, decimal);
  return n !== null && n > 0 ? n : null;
}

export function parseSide(raw: string): "buy" | "sell" | null {
  const s = raw.trim().toLowerCase();
  if (["b", "buy", "bot", "bought", "long", "buy to open", "buy to cover", "1"].includes(s))
    return "buy";
  if (["s", "sell", "sld", "sold", "short", "sell short", "sell to open", "-1"].includes(s))
    return "sell";
  if (s.startsWith("buy")) return "buy";
  if (s.startsWith("sell")) return "sell";
  return null;
}

/**
 * Timestamp → ISO UTC. Values with Z/offset are absolute; others are wall
 * time in `tz`. Supports ISO (2026-09-21 14:30:05[.123]), m/d/y and d/m/y with
 * 2- or 4-digit years, optional AM/PM, and a separate date column.
 */
export function parseTimestamp(
  value: string,
  format: DateFormat,
  tz: string,
  dateValue?: string,
): string | null {
  let s = (dateValue ? `${dateValue.trim()} ${value.trim()}` : value.trim()).replace(/\s+/g, " ");
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  s = s.replace("T", " ");
  const m =
    /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?\s*(AM|PM)?)?$/i.exec(
      s,
    );
  if (!m) return null;
  const [, a, b, c, hh = "0", mi = "0", ss = "0", frac = "", ampm] = m;
  let y: number, mo: number, d: number;
  const fmt = format === "auto-iso" ? (a.length === 4 ? "ymd" : "mdy") : format;
  if (fmt === "ymd") [y, mo, d] = [Number(a), Number(b), Number(c)];
  else if (fmt === "dmy") [d, mo, y] = [Number(a), Number(b), Number(c)];
  else [mo, d, y] = [Number(a), Number(b), Number(c)];
  if (y < 100) y += 2000;
  let h = Number(hh);
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
  }
  const min = Number(mi);
  const sec = Number(ss);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const ms = frac ? `.${frac.padEnd(3, "0").slice(0, 3)}` : "";
  const wall = `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(min)}:${pad(sec)}${ms}`;
  const out = zonedWallTimeToUtc(wall, tz);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

export function mapRows(
  headers: string[],
  rows: string[][],
  mapping: ImportMapping,
  instruments: ImportInstrument[],
): { fills: Fill[]; errors: RowError[]; unknownSymbols: string[] } {
  const idx = (f: FillField) => {
    const h = mapping.columns[f];
    return h ? headers.indexOf(h) : -1;
  };
  const col = Object.fromEntries(FILL_FIELDS.map((f) => [f, idx(f)])) as Record<FillField, number>;
  const fills: Fill[] = [];
  const errors: RowError[] = [];
  const unknown = new Set<string>();
  const missing = REQUIRED_FIELDS.filter((f) => col[f] < 0);
  if (missing.length) {
    return {
      fills,
      errors: [{ row: 0, message: `Map the ${missing.join(", ")} column(s)` }],
      unknownSymbols: [],
    };
  }
  rows.forEach((cells, i) => {
    const row = i + 1;
    const get = (f: FillField) => (col[f] >= 0 ? (cells[col[f]] ?? "").trim() : "");
    const rawSymbol = get("symbol");
    if (!rawSymbol) return errors.push({ row, message: "No symbol" });
    const inst = resolveSymbol(rawSymbol, instruments, mapping.symbolMap);
    if (!inst) {
      unknown.add(rawSymbol.toUpperCase());
      return errors.push({ row, message: `Unknown symbol "${rawSymbol}"` });
    }
    const qtyRaw = parseNumber(get("qty"), mapping.decimal);
    if (qtyRaw === null || qtyRaw === 0)
      return errors.push({ row, message: "Quantity missing or zero" });
    let side = col.side >= 0 ? parseSide(get("side")) : null;
    if (!side) {
      if (col.side >= 0 && get("side"))
        return errors.push({ row, message: `Unknown side "${get("side")}"` });
      side = qtyRaw > 0 ? "buy" : "sell";
    }
    const price = parsePriceFor(get("price"), inst, mapping.decimal);
    if (price === null) return errors.push({ row, message: `Bad price "${get("price")}"` });
    const at = parseTimestamp(
      get("time"),
      mapping.dateFormat,
      mapping.timezone,
      col.date >= 0 ? get("date") : undefined,
    );
    if (!at) return errors.push({ row, message: `Bad time "${get("time")}"` });
    const feeRaw = col.fee >= 0 && get("fee") ? parseNumber(get("fee"), mapping.decimal) : null;
    fills.push({
      row,
      account: get("account") || "default",
      rawSymbol,
      instrumentId: inst.id,
      symbol: inst.symbol,
      side,
      qty: Math.abs(qtyRaw),
      price,
      at,
      fee: feeRaw === null ? null : Math.abs(feeRaw),
      orderId: get("orderId") || null,
      raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""])),
    });
  });
  return { fills, errors, unknownSymbols: [...unknown].sort() };
}
