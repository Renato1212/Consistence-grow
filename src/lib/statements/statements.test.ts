import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRODUCTS,
  buildAxiaStatementPdf,
  fixtureAmounts,
  type FixtureSpec,
} from "../../../tests/fixtures/axia-statement";
import { defaultSpec } from "@/lib/trading/instrument-specs";

import {
  StatementFormatError,
  parseAmount,
  parseAxiaStatement,
  parseStatementDate,
  parseStatementPrice,
} from "./axia";
import { runChecks, statementStatus } from "./checks";
import { extractPages, sha256Hex } from "./extract";
import { impliedMultiplier, multiplierMatches, resolveProduct } from "./products";

async function parse(spec: FixtureSpec) {
  const bytes = await buildAxiaStatementPdf(spec);
  const parsed = parseAxiaStatement(await extractPages(bytes));
  const checks = runChecks(parsed);
  return { bytes, parsed, checks, status: statementStatus(checks) };
}

const BASE: FixtureSpec = { tradeDate: "2026-09-28", products: DEFAULT_PRODUCTS };

describe("value parsers", () => {
  it("reads amounts, dates and printed prices", () => {
    expect(parseAmount("-46,726.00")).toBe(-46726);
    expect(parseAmount("(1,234.50)")).toBe(-1234.5);
    expect(parseAmount("1")).toBe(1);
    expect(parseAmount("USD")).toBeNull();
    expect(parseStatementDate("28-Sep-2026")).toBe("2026-09-28");
    expect(parseStatementDate("Monday, 28 Sep 2026")).toBe("2026-09-28");
    expect(parseStatementDate("31-Feb-2026")).toBeNull();
    expect(parseStatementPrice("104'115")).toBeCloseTo(104 + 11.5 / 32, 9);
    expect(parseStatementPrice("7755.25")).toBe(7755.25);
    expect(parseStatementPrice("96")).toBe(96);
    expect(parseStatementPrice("abc")).toBeNull();
  });
});

describe("Axia daily detail statement", () => {
  it("parses header, summary, NLV history, fills and products; every check passes", async () => {
    const { parsed, checks, status } = await parse(BASE);
    const expected = fixtureAmounts(BASE);
    expect(parsed).toMatchObject({
      tradeDate: "2026-09-28",
      client: "APT0000",
      account: "OBS_TEST",
      program: "Axia Pro Trial",
      simulated: true,
      currency: "USD",
      psTotal: expected.realized,
      unparsed: [],
    });
    expect(parsed.summary.realizedPnl).toBe(expected.realized);
    expect(parsed.summary.closeCash).toBe(expected.close);
    expect(parsed.summary.netLiquidValue).toBe(expected.close);
    expect(parsed.nlvHistory.map((n) => n.offset)).toEqual([-4, -3, -2, -1, 0]);
    expect(parsed.nlvHistory.at(-1)).toMatchObject({
      nlv: expected.close,
      change: expected.realized,
    });
    expect(parsed.fills.filter((f) => f.section === "confirmation")).toHaveLength(10);
    expect(parsed.fills.filter((f) => f.section === "purchase")).toHaveLength(10);
    expect(parsed.products.map((p) => [p.code, p.longQty, p.shortQty, p.realizedPnl])).toEqual(
      expected.products.map((p) => [
        p.code,
        p.fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.qty, 0),
        p.fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.qty, 0),
        p.realized,
      ]),
    );
    const zn = parsed.products.find((p) => p.code === "21")!;
    expect(zn.avgBuy).toBeCloseTo((3 * (104 + 11.5 / 32) + (104 + 13 / 32)) / 4, 5);
    expect(zn.description).toBe("10Y T-NOTE");
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe("ok");
  });

  it("joins a product name split across text runs", async () => {
    const { parsed, status } = await parse({ ...BASE, tamper: { splitProductText: true } });
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.products.find((p) => p.code === "EF")?.description).toBe("MICR CRUDE");
    expect(status).toBe("ok");
  });

  it("flags a summary that disagrees with the trades", async () => {
    const { checks, status } = await parse({ ...BASE, tamper: { summaryRealized: 123.45 } });
    expect(checks.find((c) => c.id === "realized")?.ok).toBe(false);
    expect(status).toBe("attention");
  });

  it("flags a missing Total line instead of guessing", async () => {
    const { checks, status } = await parse({ ...BASE, tamper: { dropTotalFor: "MS" } });
    const bad = checks.filter((c) => !c.ok && c.severity === "error").map((c) => c.id);
    expect(bad).toContain("totals:confirmation:MS|DEC-26");
    expect(status).toBe("attention");
  });

  it("keeps unknown lines visible as a warning", async () => {
    const { parsed, checks, status } = await parse({
      ...BASE,
      tamper: { extraLine: "ADJUSTMENT 12.00" },
    });
    expect(parsed.unparsed).toContain("ADJUSTMENT 12.00");
    expect(checks.find((c) => c.id === "unparsed")).toMatchObject({
      ok: false,
      severity: "warning",
    });
    expect(status).toBe("ok");
  });

  it("treats a position closed from a prior day as a warning, not an error", async () => {
    const carried: FixtureSpec = {
      tradeDate: "2026-09-29",
      products: [
        {
          ...DEFAULT_PRODUCTS[1],
          fills: [
            { side: "buy", qty: 2, price: "7750", date: "2026-09-28" },
            { side: "sell", qty: 2, price: "7760" },
          ],
        },
      ],
    };
    const { parsed, checks, status } = await parse(carried);
    expect(parsed.products[0]).toMatchObject({ longQty: 0, shortQty: 2, realizedPnl: 100 });
    expect(checks.find((c) => c.id === "flat:MS|DEC-26")).toMatchObject({ severity: "warning" });
    expect(status).toBe("ok");
  });

  it("follows a product across page breaks", async () => {
    const many: FixtureSpec = {
      tradeDate: "2026-09-28",
      products: [
        DEFAULT_PRODUCTS[0],
        {
          ...DEFAULT_PRODUCTS[1],
          fills: Array.from({ length: 60 }, (_, i) => ({
            side: i < 30 ? ("buy" as const) : ("sell" as const),
            qty: 1 + (i % 3),
            price: String(7750 + (i % 7) * 0.25),
          })),
        },
      ],
    };
    const { parsed, checks, status } = await parse(many);
    expect(parsed.fills.filter((f) => f.code === "MS")).toHaveLength(120);
    expect(parsed.unparsed).toEqual([]);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe("ok");
  });

  it("rejects other reports", async () => {
    const bytes = await buildAxiaStatementPdf({ ...BASE, tamper: { report: "Monthly Summary" } });
    const pages = await extractPages(bytes);
    expect(() => parseAxiaStatement(pages)).toThrow(StatementFormatError);
  });

  it("hashes files deterministically", async () => {
    const h = await sha256Hex(new TextEncoder().encode("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("product codes", () => {
  it("resolves Axia codes, user overrides and descriptions", () => {
    expect(resolveProduct({ code: "EF", description: "MICR CRUDE" })).toEqual({
      symbol: "MCL",
      priceScale: 1,
      source: "default",
    });
    expect(resolveProduct({ code: "J1", description: "JPY" })?.priceScale).toBe(0.0001);
    expect(resolveProduct({ code: "XX", description: "CME E-MINI NASDAQ" })).toMatchObject({
      symbol: "NQ",
      source: "description",
    });
    expect(
      resolveProduct(
        { code: "MS", description: "MICRO S&P" },
        { MS: { symbol: "ES", priceScale: 1 } },
      ),
    ).toMatchObject({ symbol: "ES", source: "user" });
    expect(resolveProduct({ code: "ZZ", description: "LEAN HOGS" })).toBeNull();
  });

  it("proves the mapping with the contract multiplier implied by the amounts", async () => {
    const { parsed } = await parse(BASE);
    const ps = (code: string) =>
      parsed.fills.filter((f) => f.section === "purchase" && f.code === code);
    const spec = (s: string) => {
      const d = defaultSpec(s);
      return { tickSize: d.tickSize, tickValue: d.tickValue };
    };
    expect(multiplierMatches(impliedMultiplier(ps("21")), spec("ZN"))).toBe(true);
    expect(multiplierMatches(impliedMultiplier(ps("MS")), spec("MES"))).toBe(true);
    expect(multiplierMatches(impliedMultiplier(ps("EF")), spec("MCL"))).toBe(true);
    expect(multiplierMatches(impliedMultiplier(ps("EF")), spec("CL"))).toBe(false);
    expect(multiplierMatches(impliedMultiplier(ps("J1")), spec("6J"), 0.0001)).toBe(true);
    expect(multiplierMatches(impliedMultiplier(ps("J1")), spec("6J"))).toBe(false);
  });
});
