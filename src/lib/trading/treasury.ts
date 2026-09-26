/**
 * Treasury futures prices in points and 32nds.
 *
 * Accepted input (all equal 110 + 16.5/32 = 110.515625):
 *   decimal          110.515625
 *   32nds + decimal  110'16.5   110-16.5   110 16.5
 *   CME 3-digit      110'165    (last digit = fraction of a 32nd)
 *   plus sign        110'16+    (= half a 32nd)
 * Whole 32nds: 110'16, 110-16.
 *
 * CME 3-digit fraction codes: 0=0, 1=⅛, 2=¼, 3=⅜, 5=½, 6=⅝, 7=¾, 8=⅞.
 */
const FRACTION_CODE: Record<string, number> = {
  "0": 0,
  "1": 0.125,
  "2": 0.25,
  "3": 0.375,
  "5": 0.5,
  "6": 0.625,
  "7": 0.75,
  "8": 0.875,
};

const CODE_FOR_FRACTION = new Map(Object.entries(FRACTION_CODE).map(([k, v]) => [v, k]));

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

const EPS = 1e-9;

function isMultipleOf(value: number, step: number) {
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

export function parseTreasuryPrice(raw: string, tickSize?: number): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Enter a price" };

  let value: number;
  const sep = input.match(/^(\d+)\s*['\-\s]\s*(\d{1,3})(\.\d+|\+)?$/);
  if (sep) {
    const points = Number(sep[1]);
    const digits = sep[2];
    const tail = sep[3];
    let thirtySeconds: number;
    if (tail === "+") {
      if (digits.length > 2) return { ok: false, error: "Use 110'16+ or 110'165, not both" };
      thirtySeconds = Number(digits) + 0.5;
    } else if (tail) {
      if (digits.length > 2)
        return { ok: false, error: "Too many digits before the decimal point" };
      thirtySeconds = Number(`${digits}${tail}`);
    } else if (digits.length === 3) {
      const frac = FRACTION_CODE[digits[2]];
      if (frac === undefined) return { ok: false, error: `Invalid fraction digit "${digits[2]}"` };
      thirtySeconds = Number(digits.slice(0, 2)) + frac;
    } else {
      thirtySeconds = Number(digits);
    }
    if (thirtySeconds >= 32) return { ok: false, error: "32nds must be below 32" };
    value = points + thirtySeconds / 32;
  } else if (/^\d+(\.\d+)?$/.test(input)) {
    value = Number(input);
  } else {
    return { ok: false, error: "Use 110'16.5, 110'165 or a decimal price" };
  }

  if (tickSize !== undefined && !isMultipleOf(value, tickSize)) {
    return { ok: false, error: "Price is not on a valid tick" };
  }
  return { ok: true, value };
}

/**
 * Format a decimal price as CME-style 32nds. Whole-32nd contracts (ZB/UB) use
 * two digits (110'16); finer ticks use the 3-digit form (110'165).
 */
export function formatTreasuryPrice(value: number, tickSize: number): string {
  const points = Math.floor(value + EPS);
  const thirtySeconds = (value - points) * 32;
  const whole = Math.floor(thirtySeconds + EPS);
  const frac = Math.round((thirtySeconds - whole) * 1000) / 1000;
  const wholeStr = String(whole).padStart(2, "0");
  if (tickSize >= 1 / 32 - EPS) return `${points}'${wholeStr}`;
  const code = CODE_FOR_FRACTION.get(frac);
  if (code === undefined) return `${points}'${wholeStr}.${String(frac).slice(2)}`;
  return `${points}'${wholeStr}${code}`;
}
