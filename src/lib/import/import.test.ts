import { describe, expect, it } from "vitest";

import { detectDelimiter, parseCsv } from "./csv";
import { groupFills } from "./group";
import { fillHash } from "./hash";
import {
  DEFAULT_MAPPING,
  guessColumns,
  mapRows,
  parseNumber,
  parsePriceFor,
  parseSide,
  parseTimestamp,
  resolveSymbol,
  type Fill,
  type ImportInstrument,
} from "./parse";
import { planImport, rpcPayload } from "./plan";

const ES: ImportInstrument = { id: "es", symbol: "ES", tickSize: 0.25, priceFormat: "decimal" };
const MES: ImportInstrument = { id: "mes", symbol: "MES", tickSize: 0.25, priceFormat: "decimal" };
const E6: ImportInstrument = { id: "6e", symbol: "6E", tickSize: 0.00005, priceFormat: "decimal" };
const ZN: ImportInstrument = {
  id: "zn",
  symbol: "ZN",
  tickSize: 1 / 64,
  priceFormat: "thirty_seconds",
};
const INSTRUMENTS = [ES, MES, E6, ZN];

let row = 0;
function fill(p: Partial<Fill>): Fill {
  row++;
  return {
    row,
    account: "A1",
    rawSymbol: "ESZ6",
    instrumentId: "es",
    symbol: "ES",
    side: "buy",
    qty: 1,
    price: 5000,
    at: `2026-09-21T13:${String(row % 60).padStart(2, "0")}:00.000Z`,
    fee: null,
    orderId: null,
    raw: {},
    ...p,
  };
}

describe("csv", () => {
  it("parses quotes, escaped quotes, embedded newlines, BOM and CRLF", () => {
    const text = '﻿Symbol,Note,Qty\r\nESZ6,"a, ""quoted""\nline",2\r\n\r\nNQZ6,,1\r\n';
    const csv = parseCsv(text);
    expect(csv.headers).toEqual(["Symbol", "Note", "Qty"]);
    expect(csv.rows).toEqual([
      ["ESZ6", 'a, "quoted"\nline', "2"],
      ["NQZ6", "", "1"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('"x;y",b,c')).toBe(",");
    expect(parseCsv("Price;Qty\n5000,25;1").rows).toEqual([["5000,25", "1"]]);
  });
});

describe("field parsing", () => {
  it("numbers with thousands separators, decimal commas, currency and parentheses", () => {
    expect(parseNumber("5,012.25", ".")).toBe(5012.25);
    expect(parseNumber("5.012,25", ",")).toBe(5012.25);
    expect(parseNumber("$(2.50)", ".")).toBe(-2.5);
    expect(parseNumber("abc", ".")).toBeNull();
    expect(parseNumber("", ".")).toBeNull();
  });

  it("prices in 32nds for treasuries, decimals elsewhere", () => {
    expect(parsePriceFor("110'16.5", ZN, ".")).toBeCloseTo(110.515625, 9);
    expect(parsePriceFor("110.515625", ZN, ".")).toBeCloseTo(110.515625, 9);
    expect(parsePriceFor("1.08455", E6, ".")).toBe(1.08455);
    expect(parsePriceFor("-3", ES, ".")).toBeNull();
  });

  it("sides from common spellings", () => {
    expect(parseSide("B")).toBe("buy");
    expect(parseSide("Bought")).toBe("buy");
    expect(parseSide("SELL SHORT")).toBe("sell");
    expect(parseSide("Sld")).toBe("sell");
    expect(parseSide("x")).toBeNull();
  });

  it("timestamps: wall time in the file's zone, across DST, offsets respected", () => {
    // 09:30 Chicago in summer (CDT, UTC−5) and winter (CST, UTC−6)
    expect(parseTimestamp("2026-09-21 09:30:05", "auto-iso", "America/Chicago")).toBe(
      "2026-09-21T14:30:05.000Z",
    );
    expect(parseTimestamp("2026-12-21 09:30:05.25", "auto-iso", "America/Chicago")).toBe(
      "2026-12-21T15:30:05.250Z",
    );
    expect(parseTimestamp("09/21/2026 2:30:05 PM", "auto-iso", "UTC")).toBe(
      "2026-09-21T14:30:05.000Z",
    );
    expect(parseTimestamp("21/09/26 14:30", "dmy", "Europe/Lisbon")).toBe(
      "2026-09-21T13:30:00.000Z",
    );
    expect(parseTimestamp("2026-09-21T14:30:05+02:00", "auto-iso", "America/Chicago")).toBe(
      "2026-09-21T12:30:05.000Z",
    );
    expect(parseTimestamp("14:30:05", "mdy", "UTC", "09/21/2026")).toBe("2026-09-21T14:30:05.000Z");
    expect(parseTimestamp("2026-02-30 10:00", "auto-iso", "UTC")).toBeNull();
    expect(parseTimestamp("13:00 PM", "auto-iso", "UTC", "2026-09-21")).toBeNull();
    expect(parseTimestamp("garbage", "auto-iso", "UTC")).toBeNull();
  });

  it("symbols: explicit map, exact, futures codes, platform prefixes", () => {
    expect(resolveSymbol("ESZ6", INSTRUMENTS)?.symbol).toBe("ES");
    expect(resolveSymbol("ESZ26", INSTRUMENTS)?.symbol).toBe("ES");
    expect(resolveSymbol("MESH27", INSTRUMENTS)?.symbol).toBe("MES");
    expect(resolveSymbol("6EZ6", INSTRUMENTS)?.symbol).toBe("6E");
    expect(resolveSymbol("ESZ6.CME", INSTRUMENTS)?.symbol).toBe("ES");
    expect(resolveSymbol("es", INSTRUMENTS)?.symbol).toBe("ES");
    expect(resolveSymbol("F.US.EPZ26", INSTRUMENTS)).toBeNull();
    expect(resolveSymbol("F.US.EPZ26", INSTRUMENTS, { EP: "ES" })?.symbol).toBe("ES");
    expect(resolveSymbol("CLZ6", INSTRUMENTS)).toBeNull();
  });

  it("guesses columns from common headers", () => {
    const g = guessColumns([
      "Account",
      "Symbol",
      "B/S",
      "Filled Qty",
      "Avg Fill Price",
      "Update Time",
      "Commission",
    ]);
    expect(g).toMatchObject({
      account: "Account",
      symbol: "Symbol",
      side: "B/S",
      qty: "Filled Qty",
      price: "Avg Fill Price",
      time: "Update Time",
      fee: "Commission",
    });
  });
});

describe("mapRows", () => {
  const headers = ["Account", "Symbol", "Side", "Qty", "Price", "Time", "Fee"];
  const mapping = {
    ...DEFAULT_MAPPING,
    timezone: "UTC",
    columns: {
      account: "Account",
      symbol: "Symbol",
      side: "Side",
      qty: "Qty",
      price: "Price",
      time: "Time",
      fee: "Fee",
    },
  };

  it("builds fills and reports row errors and unknown symbols", () => {
    const rows = [
      ["A1", "ESZ6", "Buy", "2", "5000.25", "2026-09-21 14:30:00", "4.1"],
      ["A1", "CLZ6", "Buy", "1", "70", "2026-09-21 14:31:00", ""],
      ["A1", "ESZ6", "Hold", "1", "5000", "2026-09-21 14:32:00", ""],
      ["A1", "ESZ6", "Sell", "0", "5000", "2026-09-21 14:33:00", ""],
      ["A1", "ESZ6", "Sell", "2", "x", "2026-09-21 14:34:00", ""],
      ["A1", "ESZ6", "Sell", "2", "5001", "later", ""],
    ];
    const r = mapRows(headers, rows, mapping, INSTRUMENTS);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({
      side: "buy",
      qty: 2,
      price: 5000.25,
      fee: 4.1,
      at: "2026-09-21T14:30:00.000Z",
    });
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.unknownSymbols).toEqual(["CLZ6"]);
  });

  it("takes the side from a signed quantity when there is no side column", () => {
    const r = mapRows(
      ["Symbol", "Qty", "Price", "Time"],
      [["ESZ6", "-3", "5000", "2026-09-21 14:30"]],
      {
        ...DEFAULT_MAPPING,
        timezone: "UTC",
        columns: { symbol: "Symbol", qty: "Qty", price: "Price", time: "Time" },
      },
      INSTRUMENTS,
    );
    expect(r.fills[0]).toMatchObject({ side: "sell", qty: 3, account: "default" });
  });

  it("asks for the required columns", () => {
    const r = mapRows(["Symbol"], [["ESZ6"]], DEFAULT_MAPPING, INSTRUMENTS);
    expect(r.errors[0].message).toContain("Map the symbol, qty, price, time");
  });
});

describe("groupFills", () => {
  it("round trip with scaling in and out, weighted averages and fees", () => {
    const g = groupFills([
      fill({ side: "buy", qty: 1, price: 5000, fee: 2 }),
      fill({ side: "buy", qty: 2, price: 5003, fee: 4 }),
      fill({ side: "sell", qty: 1, price: 5010, fee: 2 }),
      fill({ side: "sell", qty: 2, price: 5004, fee: 4 }),
    ]);
    expect(g.open).toEqual([]);
    expect(g.trades).toHaveLength(1);
    const t = g.trades[0];
    expect(t).toMatchObject({
      direction: "long",
      contracts: 3,
      entryPrice: 5002,
      exitPrice: 5006,
      fees: 12,
    });
  });

  it("a reversal closes one trade and opens the next with the remainder", () => {
    const g = groupFills([
      fill({ side: "sell", qty: 2, price: 5010, fee: 2 }),
      fill({ side: "buy", qty: 5, price: 5000, fee: 5 }), // closes 2 short, opens 3 long
      fill({ side: "sell", qty: 3, price: 5004 }),
    ]);
    expect(g.trades.map((t) => [t.direction, t.contracts, t.entryPrice, t.exitPrice])).toEqual([
      ["short", 2, 5010, 5000],
      ["long", 3, 5000, 5004],
    ]);
    expect(g.trades[0].fees).toBe(4); // 2 + 2/5 of 5
    expect(g.trades[1].fees).toBe(3); // 3/5 of 5
  });

  it("books per account and instrument; reports open positions", () => {
    const g = groupFills([
      fill({ account: "A1", side: "buy" }),
      fill({ account: "A2", side: "sell" }),
      fill({ account: "A1", side: "sell" }),
      fill({ account: "A2", instrumentId: "mes", symbol: "MES", side: "buy", qty: 2 }),
    ]);
    expect(g.trades).toHaveLength(1);
    expect(g.trades[0].account).toBe("A1");
    expect(g.open.map((o) => [o.account, o.symbol, o.qty])).toEqual([
      ["A2", "ES", -1],
      ["A2", "MES", 2],
    ]);
  });

  it("uses file order for fills in the same instant", () => {
    const at = "2026-09-21T14:00:00.000Z";
    const g = groupFills([fill({ at, side: "buy" }), fill({ at, side: "sell", price: 5001 })]);
    expect(g.trades[0]).toMatchObject({ direction: "long", exitPrice: 5001 });
  });
});

describe("planImport", () => {
  const none = async () => ({ fills: new Set<string>(), trades: new Set<string>() });

  it("is stable across runs and skips trades already imported", async () => {
    const fills = () => [
      fill({ row: 1, at: "2026-09-21T14:00:00.000Z", side: "buy" }),
      fill({ row: 2, at: "2026-09-21T14:01:00.000Z", side: "sell", price: 5002 }),
      fill({ row: 3, at: "2026-09-21T14:02:00.000Z", side: "sell" }),
      fill({ row: 4, at: "2026-09-21T14:03:00.000Z", side: "buy", price: 4998 }),
    ];
    const first = await planImport(fills(), none);
    expect(first.create).toHaveLength(2);
    const again = await planImport(fills(), none);
    expect(again.create.map((t) => t.importHash)).toEqual(first.create.map((t) => t.importHash));

    const known = async () => ({
      fills: new Set([first.create[0].fillHashes[0]]),
      trades: new Set<string>(),
    });
    const second = await planImport(fills(), known);
    expect(second.create).toHaveLength(1);
    expect(second.duplicates).toHaveLength(1);
  });

  it("keeps identical fills in one file apart", async () => {
    const at = "2026-09-21T14:00:00.000Z";
    const p = await planImport(
      [
        fill({ at, side: "buy" }),
        fill({ at, side: "buy" }),
        fill({ side: "sell", qty: 2, at: "2026-09-21T14:05:00.000Z" }),
      ],
      none,
    );
    const hashes = p.create[0].fillHashes;
    expect(new Set(hashes).size).toBe(3);
    expect(
      await fillHash({ account: "A1", rawSymbol: "ESZ6", at, price: 5000, qty: 1, side: "buy" }),
    ).toBe(hashes[0]);
  });

  it("stores a split fill once, with the trade it closes", async () => {
    const p = await planImport(
      [
        fill({ side: "sell", qty: 1, at: "2026-09-21T14:00:00.000Z" }),
        fill({ side: "buy", qty: 2, at: "2026-09-21T14:01:00.000Z" }),
        fill({ side: "sell", qty: 1, at: "2026-09-21T14:02:00.000Z" }),
      ],
      none,
    );
    const payload = rpcPayload(p.create);
    expect(payload.map((t) => t.fills.length)).toEqual([2, 1]);
    expect(new Set(payload.flatMap((t) => t.fills.map((f) => f.hash))).size).toBe(3);
  });
});
