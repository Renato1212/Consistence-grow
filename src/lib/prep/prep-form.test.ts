import { describe, expect, it } from "vitest";

import {
  carryForward,
  copyFromPrep,
  emptyPrep,
  hasContent,
  isReady,
  parseLevelPrice,
  prepRowToSnapshot,
  sortLevels,
  toPrepPayload,
  type LevelDraft,
  type PrepInstrument,
} from "./prep-form";

const ES: PrepInstrument = { id: "es", symbol: "ES", tickSize: 0.25, priceFormat: "decimal" };
const ZN: PrepInstrument = {
  id: "zn",
  symbol: "ZN",
  tickSize: 1 / 64,
  priceFormat: "thirty_seconds",
};
const inst = [ES, ZN];

const level = (over: Partial<LevelDraft>): LevelDraft => ({
  id: "l",
  instrumentId: "es",
  priceLow: "5000",
  priceHigh: "",
  levelType: "PDH",
  strength: 2,
  note: "",
  carriedFromId: null,
  ...over,
});

let seq = 0;
const newId = () => `new-${++seq}`;

describe("level prices", () => {
  it("accepts off-tick decimals, comma decimals and 32nds", () => {
    expect(parseLevelPrice("5012,37", ES)).toEqual({ value: 5012.37 });
    expect(parseLevelPrice("110'16.5", ZN).value).toBeCloseTo(110.515625);
    expect(parseLevelPrice("-1", ES).error).toBeDefined();
    expect(parseLevelPrice("abc", ES).error).toBe("Not a number");
  });
});

describe("toPrepPayload", () => {
  it("maps fields, drops incomplete levels, orders zones and reports invalid prices", () => {
    const p = {
      ...emptyPrep("p1", "2026-09-28", "EU" as const),
      sleep: 4,
      narrative: "  CPI focus ",
      maxLossUsd: "500",
      maxTrades: "3.4",
      maxSize: "-2",
      levels: [
        level({ id: "a", priceLow: "5010", priceHigh: "5000" }),
        level({ id: "b", priceLow: "" }),
        level({ id: "c", priceLow: "x" }),
        level({ id: "d", instrumentId: "zn", priceLow: "110'16", priceHigh: "110'16" }),
      ],
      scenarios: [
        {
          id: "s1",
          instrumentId: "es",
          direction: "long" as const,
          ifText: "if",
          thenText: "then",
          playbookId: "",
          domain: "" as const,
        },
        {
          id: "s2",
          instrumentId: "",
          direction: "" as const,
          ifText: " ",
          thenText: "",
          playbookId: "",
          domain: "" as const,
        },
      ],
      ruleChecks: { r1: true, r2: false },
    };
    const { payload, issues } = toPrepPayload(p, inst);
    expect(payload).toMatchObject({
      id: "p1",
      date: "2026-09-28",
      session: "EU",
      sleep: 4,
      narrative: "CPI focus",
      max_loss_usd: 500,
      max_trades: 3,
      max_size: null,
      vol_state: "",
    });
    const levels = payload.levels as Record<string, unknown>[];
    expect(levels.map((l) => l.id)).toEqual(["a", "d"]);
    expect(levels[0]).toMatchObject({ price_low: 5000, price_high: 5010 });
    expect(levels[1]).toMatchObject({ price_low: 110.5, price_high: null });
    expect(issues).toEqual([{ id: "c", message: "Not a number" }]);
    expect((payload.scenarios as unknown[]).length).toBe(1);
    expect(payload.rule_checks).toEqual([
      { rule_id: "r1", followed: true },
      { rule_id: "r2", followed: false },
    ]);
  });
});

describe("level helpers", () => {
  it("sorts strongest first, then by price", () => {
    const sorted = sortLevels([
      level({ id: "1", strength: 1, priceLow: "10" }),
      level({ id: "2", strength: 3, priceLow: "5" }),
      level({ id: "3", strength: 3, priceLow: "7" }),
      level({ id: "4", strength: 2, priceLow: "1" }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["3", "2", "4", "1"]);
  });

  it("carries forward only untested levels, once", () => {
    const prev = [level({ id: "p1" }), level({ id: "p2" }), level({ id: "p3" })];
    const tested = { p1: true, p2: false, p3: null };
    const first = carryForward([], prev, tested, newId);
    expect(first.map((l) => l.carriedFromId)).toEqual(["p2", "p3"]);
    expect(first.every((l) => l.id.startsWith("new-"))).toBe(true);
    expect(carryForward(first, prev, tested, newId)).toEqual([]);
  });
});

describe("copy EU → US", () => {
  it("copies context, focus, risk, levels and scenarios but not readiness or brief", () => {
    const eu = {
      ...emptyPrep("eu", "2026-09-28", "EU" as const),
      sleep: 5,
      briefMd: "EU brief",
      regime: "Trending",
      maxLossUsd: "400",
      focusInstrumentIds: ["es"],
      levels: [level({ id: "e1" })],
      scenarios: [
        {
          id: "s1",
          instrumentId: "es",
          direction: "short" as const,
          ifText: "a",
          thenText: "b",
          playbookId: "",
          domain: "" as const,
        },
      ],
    };
    const us = emptyPrep("us", "2026-09-28", "US");
    const copied = copyFromPrep(us, eu, newId);
    expect(copied).toMatchObject({
      id: "us",
      session: "US",
      sleep: null,
      briefMd: "",
      regime: "Trending",
      maxLossUsd: "400",
      focusInstrumentIds: ["es"],
      copiedFromId: "eu",
    });
    expect(copied.levels[0]).toMatchObject({ carriedFromId: "e1" });
    expect(copied.levels[0].id).not.toBe("e1");
    expect(copied.scenarios[0].id).not.toBe("s1");
    // Copying twice does not duplicate levels
    expect(copyFromPrep(copied, eu, newId).levels).toHaveLength(1);
    expect(hasContent(copied)).toBe(true);
    expect(hasContent(us)).toBe(false);
  });
});

describe("readiness and DB mapping", () => {
  it("requires all three readiness scores", () => {
    expect(isReady({ sleep: 3, energy: 3, focus: null })).toBe(false);
    expect(isReady({ sleep: 3, energy: 3, focus: 1 })).toBe(true);
  });

  it("maps DB rows back to the form", () => {
    const snap = prepRowToSnapshot(
      {
        id: "p",
        sleep: 3,
        energy: null,
        focus: null,
        how_am_i: null,
        brief_md: "# Brief",
        prior_day_type: "Trend",
        regime: null,
        vol_state: "high",
        narrative: null,
        options_notes: null,
        focus_instrument_ids: ["es"],
        focus_playbook_ids: [],
        intention: null,
        max_loss_usd: 500,
        max_loss_r: null,
        max_trades: 3,
        max_size: null,
        completed_at: null,
        copied_from_id: null,
      },
      "2026-09-28",
      "US",
      [
        {
          id: "l",
          instrument_id: "zn",
          price_low: 110.5,
          price_high: null,
          level_type: "POC",
          strength: 3,
          note: null,
          carried_from_id: null,
          tested: null,
        },
      ],
      [],
      [{ rule_id: "r", followed: true }],
      inst,
    );
    expect(snap).toMatchObject({
      volState: "high",
      maxLossUsd: "500",
      maxTrades: "3",
      briefMd: "# Brief",
      ruleChecks: { r: true },
    });
    expect(snap.levels[0].priceLow).toBe("110'160"); // CME 3-digit form for ZN
  });
});
