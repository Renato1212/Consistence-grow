/**
 * Self-checks run on every parsed statement before it is saved. Errors mean a
 * number does not add up (the statement is stored as "needs attention", never
 * silently corrected); warnings describe legitimate situations such as a
 * position carried overnight.
 */
import type { AxiaParse } from "./axia";
import type { CheckResult, StatementFill } from "./types";

const money = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

function fillKey(f: StatementFill) {
  return `${f.code}|${f.contract}|${f.side}|${f.qty}|${f.priceText}`;
}

export function runChecks(p: AxiaParse): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (r: CheckResult) => out.push(r);
  const s = p.summary;

  add({
    id: "summary",
    label: "Financial summary read",
    severity: "error",
    ok: s.realizedPnl !== undefined && s.closeCash !== undefined && s.netLiquidValue !== undefined,
    detail: s.realizedPnl === undefined ? "Realized P/L, close cash or NLV missing" : undefined,
  });

  const conf = p.fills.filter((f) => f.section === "confirmation");
  const ps = p.fills.filter((f) => f.section === "purchase");

  // Per product: printed totals, amounts vs realized, flat at the close.
  for (const prod of p.products) {
    const key = `${prod.code}|${prod.contract}`;
    const name = `${prod.code} ${prod.contract}`;
    for (const section of ["confirmation", "purchase"] as const) {
      const total = p.totals.find((t) => t.key === key && t.section === section);
      const own = p.fills.filter((f) => f.section === section && `${f.code}|${f.contract}` === key);
      if (!own.length) continue;
      const long = sum(own.filter((f) => f.side === "buy").map((f) => f.qty));
      const short = sum(own.filter((f) => f.side === "sell").map((f) => f.qty));
      add({
        id: `totals:${section}:${key}`,
        label: `${name}: ${section === "confirmation" ? "confirmation" : "purchase & sale"} totals`,
        severity: "error",
        ok: !!total && total.long === long && total.short === short,
        detail: total
          ? `lines ${long}/${short}, printed ${total.long}/${total.short}`
          : "no Total line found",
      });
    }
    const psOwn = ps.filter((f) => `${f.code}|${f.contract}` === key);
    if (psOwn.length) {
      const amount = sum(psOwn.map((f) => f.amount ?? 0));
      const tol = Math.max(0.011, 0.006 * psOwn.length);
      add({
        id: `amounts:${key}`,
        label: `${name}: amounts add up to realized P/L`,
        severity: "error",
        ok: prod.realizedPnl !== null && near(amount, prod.realizedPnl, tol),
        detail: `amounts ${money(amount)}, realized ${prod.realizedPnl === null ? "missing" : money(prod.realizedPnl)}`,
      });
    }
    if (prod.longQty !== prod.shortQty) {
      add({
        id: `flat:${key}`,
        label: `${name}: flat at the close`,
        severity: "warning",
        ok: false,
        detail: `bought ${prod.longQty}, sold ${prod.shortQty} today — position carried or closed from a prior day`,
      });
    }
  }

  // Sections agree: every purchase & sale fill dated today is a confirmation.
  const remaining = new Map<string, number>();
  for (const f of conf) remaining.set(fillKey(f), (remaining.get(fillKey(f)) ?? 0) + 1);
  const missing: string[] = [];
  for (const f of ps.filter((x) => x.tradeDate === p.tradeDate)) {
    const k = fillKey(f);
    const left = remaining.get(k) ?? 0;
    if (left > 0) remaining.set(k, left - 1);
    else missing.push(`${f.code} ${f.side} ${f.qty} @ ${f.priceText}`);
  }
  if (ps.length) {
    add({
      id: "sections",
      label: "Purchase & sale fills match the confirmations",
      severity: "error",
      ok: missing.length === 0,
      detail: missing.length ? `not confirmed: ${missing.slice(0, 3).join(", ")}` : undefined,
    });
  }
  const unmatched = [...remaining.values()].reduce((a, b) => a + b, 0);
  if (unmatched > 0) {
    add({
      id: "open",
      label: "Every fill closed the same day",
      severity: "warning",
      ok: false,
      detail: `${unmatched} confirmation line(s) not in purchase & sale (open position)`,
    });
  }

  const productRealized = sum(p.products.map((x) => x.realizedPnl ?? 0));
  if (p.psTotal !== null || p.products.some((x) => x.realizedPnl !== null)) {
    add({
      id: "ps-total",
      label: "Products add up to the purchase & sale total",
      severity: "error",
      ok: p.psTotal !== null && near(productRealized, p.psTotal),
      detail: `products ${money(productRealized)}, total ${p.psTotal === null ? "missing" : money(p.psTotal)}`,
    });
  }
  if (s.realizedPnl !== undefined) {
    const traded = p.psTotal ?? (ps.length ? productRealized : 0);
    add({
      id: "realized",
      label: "Realized P/L matches the financial summary",
      severity: "error",
      ok: near(traded, s.realizedPnl),
      detail: `trades ${money(traded)}, summary ${money(s.realizedPnl)}`,
    });
  }

  // Cash roll: close = open + cash movements + realized − charges.
  if (s.openCash !== undefined && s.closeCash !== undefined) {
    const flows = sum(
      (
        [
          "cashEntries",
          "fxTrades",
          "optionPremium",
          "netEquityTrade",
          "realizedPnl",
          "fxRealizedPnl",
        ] as const
      ).map((k) => s[k] ?? 0),
    );
    const charge = s.totalCharge ?? s.totalFees ?? 0;
    const expected = s.openCash + flows;
    // Charges may be printed positive (subtracted) or negative (added).
    const ok =
      near(expected - Math.abs(charge), s.closeCash) || near(expected + charge, s.closeCash);
    add({
      id: "cash",
      label: "Close cash = open cash + realized − charges",
      severity: "error",
      ok,
      detail: `expected ${money(expected - Math.abs(charge))}, printed ${money(s.closeCash)}`,
    });
  }

  const today = p.nlvHistory.find((n) => n.offset === 0);
  if (today && s.netLiquidValue !== undefined) {
    add({
      id: "nlv",
      label: "Net liquid value matches the NLV history",
      severity: "error",
      ok: near(today.nlv, s.netLiquidValue),
      detail: `history ${money(today.nlv)}, summary ${money(s.netLiquidValue)}`,
    });
  }

  if (p.unparsed.length) {
    add({
      id: "unparsed",
      label: "Every line understood",
      severity: "warning",
      ok: false,
      detail: `${p.unparsed.length} line(s) not read: ${p.unparsed.slice(0, 2).join(" · ")}`,
    });
  }
  return out;
}

export function statementStatus(checks: CheckResult[]): "ok" | "attention" {
  return checks.some((c) => c.severity === "error" && !c.ok) ? "attention" : "ok";
}
