import { describe, expect, it } from "vitest";

import {
  emptyTradeForm,
  formatPrice,
  isoToLocalInput,
  localInputToIso,
  parseDecimal,
  parsePrice,
  toTradePayload,
  tradeRowToForm,
  type FormInstrument,
  type TradeFormValues,
} from "./trade-form";

const ES: FormInstrument = {
  id: "es-id",
  symbol: "ES",
  tickSize: 0.25,
  tickValue: 12.5,
  feePerContract: 0,
  exchangeTz: "America/Chicago",
  priceFormat: "decimal",
  currency: "USD",
};
const ZN: FormInstrument = {
  ...ES,
  id: "zn-id",
  symbol: "ZN",
  tickSize: 1 / 64,
  tickValue: 15.625,
  priceFormat: "thirty_seconds",
};
const ID = "5b7f1c1e-0000-4000-8000-000000000001";

function filled(over: Partial<TradeFormValues> = {}): TradeFormValues {
  return {
    ...emptyTradeForm({ id: ID, instrumentId: "es-id", now: new Date("2026-09-15T13:40:00Z") }),
    direction: "long",
    entryAt: "2026-09-15T14:40",
    exitAt: "2026-09-15T14:52",
    entryPrice: "5000",
    exitPrice: "5004,25",
    contracts: "2",
    primaryDomain: "TECHNICAL",
    ...over,
  };
}

describe("parseDecimal", () => {
  it.each([
    ["1.25", 1.25],
    ["1,25", 1.25],
    [" 5000 ", 5000],
    ["", null],
    [".5", 0.5],
    ["abc", "invalid"],
    ["1.2.3", "invalid"],
  ])("%j → %j", (raw, expected) => {
    expect(parseDecimal(raw)).toBe(expected);
  });
});

describe("parsePrice", () => {
  it("validates the tick for decimal contracts", () => {
    expect(parsePrice("5000.25", ES)).toEqual({ value: 5000.25 });
    expect(parsePrice("5000.10", ES).error).toMatch(/tick/);
  });
  it("uses the 32nds parser for Treasuries", () => {
    expect(parsePrice("110'165", ZN)).toEqual({ value: 110.515625 });
    expect(parsePrice("110'16.25", ZN).error).toBeDefined();
  });
  it("formats back for editing", () => {
    expect(formatPrice(5000.25, ES)).toBe("5000.25");
    expect(formatPrice(110.515625, ZN)).toBe("110'165");
    expect(formatPrice(1.085, { tickSize: 0.00005, priceFormat: "decimal" })).toBe("1.08500");
  });
});

describe("time conversion (Lisbon wall time ⇄ UTC)", () => {
  it("round-trips summer and winter times", () => {
    expect(localInputToIso("2026-07-01T14:30")).toBe("2026-07-01T13:30:00.000Z");
    expect(localInputToIso("2026-01-15T14:30")).toBe("2026-01-15T14:30:00.000Z");
    expect(isoToLocalInput("2026-07-01T13:30:00.000Z")).toBe("2026-07-01T14:30");
    expect(isoToLocalInput("2026-07-01T13:30:15.000Z")).toBe("2026-07-01T14:30:15");
    expect(localInputToIso("garbage")).toBeNull();
  });
});

describe("toTradePayload", () => {
  it("builds a complete payload", () => {
    const r = toTradePayload(filled(), ES);
    expect(r.missing).toEqual([]);
    expect(r.errors).toEqual({});
    expect(r.payload).toMatchObject({
      id: ID,
      kind: "taken",
      instrument_id: "es-id",
      direction: "long",
      entry_at: "2026-09-15T13:40:00.000Z",
      exit_at: "2026-09-15T13:52:00.000Z",
      entry_price: 5000,
      exit_price: 5004.25,
      contracts: 2,
      primary_domain: "TECHNICAL",
      fees: null,
    });
  });

  it("is saveable before the exit is known (open trade), but reports missing fields", () => {
    const r = toTradePayload(filled({ exitPrice: "", primaryDomain: null }), ES);
    expect(r.payload).not.toBeNull();
    expect(r.missing).toEqual(["exitPrice", "primaryDomain"]);
  });

  it("cannot reach the DB without direction / entry price / size", () => {
    expect(toTradePayload(filled({ direction: null }), ES).payload).toBeNull();
    expect(toTradePayload(filled({ entryPrice: "" }), ES).payload).toBeNull();
    expect(toTradePayload(filled({ contracts: "" }), ES).payload).toBeNull();
    expect(toTradePayload(filled(), undefined).payload).toBeNull();
  });

  it("observed moves need no size and never carry contracts", () => {
    const r = toTradePayload(filled({ kind: "observed", contracts: "", moveTrigger: "CPI" }), ES);
    expect(r.payload?.contracts).toBeNull();
    expect(r.payload?.move_trigger).toBe("CPI");
    expect(r.missing).not.toContain("contracts");
  });

  it("flags exit before entry and a stop on the wrong side", () => {
    const r = toTradePayload(filled({ exitAt: "2026-09-15T14:00", stopPrice: "5001" }), ES);
    expect(r.errors.exitAt).toMatch(/before entry/);
    expect(r.errors.stopPrice).toMatch(/below entry/);
    expect(r.payload).toBeNull();
    const short = toTradePayload(filled({ direction: "short", stopPrice: "4999" }), ES);
    expect(short.errors.stopPrice).toMatch(/above entry/);
  });

  it("drops the primary domain from secondary domains", () => {
    const r = toTradePayload(filled({ secondaryDomains: ["TECHNICAL", "DATA"] }), ES);
    expect(r.payload?.secondary_domains).toEqual(["DATA"]);
  });

  it("round-trips through tradeRowToForm", () => {
    const v = filled({
      stopPrice: "4998",
      gradeProcess: "A",
      thesis: "first test",
      exitAt: "2026-09-15T14:52",
    });
    const p = toTradePayload(v, ES).payload!;
    const back = tradeRowToForm(
      {
        ...p,
        exit_at: p.exit_at ?? null,
        exit_price: p.exit_price ?? null,
        contracts: p.contracts ?? null,
        stop_price: p.stop_price ?? null,
        target_price: p.target_price ?? null,
        planned_r: p.planned_r ?? null,
        fees: p.fees ?? null,
        mae_ticks: p.mae_ticks ?? null,
        mfe_ticks: p.mfe_ticks ?? null,
        primary_domain: p.primary_domain ?? null,
        secondary_domains: p.secondary_domains ?? [],
        playbook_id: p.playbook_id ?? null,
        entry_type: p.entry_type ?? null,
        exit_reason: p.exit_reason ?? null,
        confidence: p.confidence ?? null,
        grade_context: p.grade_context ?? null,
        grade_context_reason: p.grade_context_reason ?? null,
        grade_edge: p.grade_edge ?? null,
        grade_edge_reason: p.grade_edge_reason ?? null,
        grade_process: p.grade_process ?? null,
        grade_process_reason: p.grade_process_reason ?? null,
        thesis: p.thesis ?? null,
        management: p.management ?? null,
        lesson: p.lesson ?? null,
        move_trigger: p.move_trigger ?? null,
        move_phases: p.move_phases ?? null,
        kind: p.kind!,
      },
      ES,
      [],
    );
    expect(back.exitPrice).toBe("5004.25");
    expect(back.stopPrice).toBe("4998.00");
    expect(back.entryAt).toBe("2026-09-15T14:40");
    expect(back.gradeProcess).toBe("A");
    expect(back.thesis).toBe("first test");
  });
});
