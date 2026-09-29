/**
 * Broker product code → instrument symbol. Order: the user's own mapping,
 * then Axia's known clearing codes, then a guess from the printed
 * description (shown as a guess so it can be confirmed).
 */
import type { StatementFill } from "./types";

export const AXIA_CODES: Record<string, string> = {
  "21": "ZN",
  MS: "MES",
  EF: "MCL",
  MG: "MGC",
  EC: "6E",
  J1: "6J",
};

/**
 * Printed price × scale = the exchange price used everywhere else in the app.
 * Axia prints the yen future per 10,000 (63.925 = 0.0063925).
 */
export const AXIA_PRICE_SCALE: Record<string, number> = { J1: 0.0001 };

const DESCRIPTION_RULES: [RegExp, string][] = [
  [/\b2Y(R)?\b.*T-?NOTE|2 ?YEAR/i, "ZT"],
  [/\b5Y(R)?\b.*T-?NOTE|5 ?YEAR/i, "ZF"],
  [/\b10Y(R)?\b.*T-?NOTE|10 ?YEAR/i, "ZN"],
  [/ULTRA.*BOND/i, "UB"],
  [/T-?BOND|30Y/i, "ZB"],
  [/MICRO S&P|MICRO E-?MINI S&P/i, "MES"],
  [/S&P/i, "ES"],
  [/MICRO NASDAQ|MICRO NDX|MICRO E-?MINI NASDAQ/i, "MNQ"],
  [/NASDAQ|NDX/i, "NQ"],
  [/RUSSELL/i, "RTY"],
  [/\bDOW\b/i, "YM"],
  [/MICR(O)? CRUDE/i, "MCL"],
  [/CRUDE/i, "CL"],
  [/NAT(URAL)?\.? ?GAS|HENRY HUB/i, "NG"],
  [/E?MICR(O)? GOLD/i, "MGC"],
  [/GOLD/i, "GC"],
  [/SILVER/i, "SI"],
  [/COPPER/i, "HG"],
  [/EURO FX|\bEUR\b/i, "6E"],
  [/\bJPY\b|YEN/i, "6J"],
  [/\bGBP\b|BRITISH POUND/i, "6B"],
  [/\bAUD\b|AUSTRALIAN/i, "6A"],
  [/BUND/i, "FGBL"],
  [/MICRO.*BITCOIN|MICRO.*ETHER/i, ""],
  [/BITCOIN/i, "BTC"],
  [/ETHER/i, "ETH"],
];

export type ProductResolution = {
  symbol: string;
  priceScale: number;
  source: "user" | "default" | "description";
};

export type UserCodeMap = Record<string, { symbol: string; priceScale: number }>;

export function resolveProduct(
  product: { code: string; description: string },
  userMap: UserCodeMap = {},
): ProductResolution | null {
  const code = product.code.toUpperCase();
  if (userMap[code]) return { ...userMap[code], source: "user" };
  if (AXIA_CODES[code])
    return { symbol: AXIA_CODES[code], priceScale: AXIA_PRICE_SCALE[code] ?? 1, source: "default" };
  for (const [re, symbol] of DESCRIPTION_RULES) {
    if (re.test(product.description))
      return symbol ? { symbol, priceScale: 1, source: "description" } : null;
  }
  return null;
}

/**
 * Contract multiplier implied by the purchase & sale amounts
 * (|amount| = qty × price × multiplier). Used to prove a code maps to the
 * right instrument: MCL (100) vs CL (1,000) differ tenfold.
 */
export function impliedMultiplier(fills: StatementFill[]): number | null {
  const values = fills
    .filter((f) => f.amount !== null && f.price && f.qty)
    .map((f) => Math.abs(f.amount!) / (f.qty * f.price!));
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * True when the implied multiplier (per printed price unit) matches the
 * instrument's point value at the given price scale (±0.5%).
 */
export function multiplierMatches(
  implied: number | null,
  inst: { tickSize: number; tickValue: number },
  priceScale = 1,
): boolean | null {
  if (implied === null) return null;
  const expected = (inst.tickValue / inst.tickSize) * priceScale;
  return Math.abs(implied - expected) / expected < 0.005;
}
