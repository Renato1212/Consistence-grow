/** Display helpers. R is always shown before money. */

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

export function fmtR(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(2)}R`;
}

export function fmtMoney(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${sign}${sym}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtTicks(t: number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  const sign = t > 0 ? "+" : t < 0 ? "−" : "";
  return `${sign}${Math.abs(Number(t.toFixed(2)))}t`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** A price for display: averages (scale-ins, statements) trimmed to 10 significant digits. */
export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  return String(Number(Number(p).toPrecision(10)));
}

/** Tailwind class for a P&L number: green/red only for P&L. */
export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-profit" : "text-loss";
}
