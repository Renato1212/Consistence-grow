import { describe, expect, it } from "vitest";

import { DEFAULT_INSTRUMENTS, defaultSpec } from "./instrument-specs";
import { computeTrade, type PnlInstrument } from "./pnl";

const inst = (symbol: string, feePerContract = 0): PnlInstrument => ({
  ...defaultSpec(symbol),
  feePerContract,
});

const T0 = "2026-09-15T13:40:00Z"; // Tue, 09:40 New York

// One hand-computed case per instrument: 1 contract long, gross P&L in the
// instrument currency. Expected = ticks × tick value.
const CASES: [symbol: string, entry: number, exit: number, ticks: number, gross: number][] = [
  ["ES", 5000.0, 5002.5, 10, 125],
  ["MES", 5000.0, 5002.5, 10, 12.5],
  ["NQ", 18000, 18010, 40, 200],
  ["MNQ", 18000, 18010, 40, 20],
  ["RTY", 2000.0, 2001.5, 15, 75],
  ["YM", 40000, 40025, 25, 125],
  ["CL", 75.0, 75.5, 50, 500],
  ["MCL", 75.0, 75.5, 50, 50],
  ["NG", 2.5, 2.55, 50, 500],
  ["GC", 2400.0, 2405.0, 50, 500],
  ["MGC", 2400.0, 2405.0, 50, 50],
  ["SI", 30.0, 30.1, 20, 500],
  ["HG", 4.5, 4.51, 20, 250],
  ["ZT", 103 + 16 / 32, 103 + 17 / 32, 8, 62.5],
  ["ZF", 108 + 16 / 32, 108 + 17 / 32, 4, 31.25],
  ["ZN", 110 + 16 / 32, 110 + 17 / 32, 2, 31.25],
  ["ZB", 118, 119, 32, 1000],
  ["UB", 125, 125.5, 16, 500],
  ["6E", 1.085, 1.086, 20, 125],
  ["6J", 0.0067, 0.00671, 20, 125],
  ["6B", 1.27, 1.275, 50, 312.5],
  ["6A", 0.66, 0.661, 20, 100],
  ["BTC", 60000, 60100, 20, 500],
  ["ETH", 3000.0, 3010.0, 20, 500],
  ["FGBL", 131.0, 131.5, 50, 500],
];

describe("P&L per instrument", () => {
  it("covers every default instrument", () => {
    expect(CASES.map((c) => c[0]).sort()).toEqual(DEFAULT_INSTRUMENTS.map((i) => i.symbol).sort());
  });

  it.each(CASES)("%s: %d → %d = %d ticks, %d gross", (symbol, entry, exit, ticks, gross) => {
    const long = computeTrade(inst(symbol), {
      kind: "taken",
      direction: "long",
      entryAt: T0,
      entryPrice: entry,
      exitPrice: exit,
      contracts: 1,
    });
    expect(long.ticks).toBe(ticks);
    expect(long.grossPnl).toBe(gross);
    expect(long.netPnl).toBe(gross);

    // The same prices shorted lose exactly the same amount.
    const short = computeTrade(inst(symbol), {
      kind: "taken",
      direction: "short",
      entryAt: T0,
      entryPrice: entry,
      exitPrice: exit,
      contracts: 1,
    });
    expect(short.ticks).toBe(-ticks);
    expect(short.grossPnl).toBe(-gross);
  });
});

describe("fees, R and special kinds", () => {
  it("applies default round-turn fees per contract and computes R on net P&L", () => {
    // ES long 3 @ 5000, stop 4998 (8 ticks), exit 5004 (16 ticks), fee $4.50 RT/contract
    const r = computeTrade(inst("ES", 4.5), {
      kind: "taken",
      direction: "long",
      entryAt: T0,
      exitAt: "2026-09-15T13:52:30Z",
      entryPrice: 5000,
      exitPrice: 5004,
      stopPrice: 4998,
      contracts: 3,
    });
    expect(r.grossPnl).toBe(600); // 16 × 12.5 × 3
    expect(r.feesTotal).toBe(13.5);
    expect(r.netPnl).toBe(586.5);
    expect(r.riskUsd).toBe(300); // 8 × 12.5 × 3
    expect(r.rMultiple).toBe(1.955);
    expect(r.noStop).toBe(false);
    expect(r.durationSec).toBe(750);
  });

  it("manual fee override wins over the instrument default", () => {
    const r = computeTrade(inst("ES", 4.5), {
      kind: "taken",
      direction: "long",
      entryAt: T0,
      entryPrice: 5000,
      exitPrice: 5001,
      contracts: 2,
      fees: 3,
    });
    expect(r.feesTotal).toBe(3);
    expect(r.netPnl).toBe(97);
  });

  it("no stop → no R, flagged", () => {
    const r = computeTrade(inst("NQ"), {
      kind: "taken",
      direction: "short",
      entryAt: T0,
      entryPrice: 18000,
      exitPrice: 17990,
      contracts: 1,
    });
    expect(r.rMultiple).toBeNull();
    expect(r.riskUsd).toBeNull();
    expect(r.noStop).toBe(true);
  });

  it("losing short with stop gives negative R", () => {
    const r = computeTrade(inst("CL"), {
      kind: "taken",
      direction: "short",
      entryAt: T0,
      entryPrice: 75.0,
      exitPrice: 75.2,
      stopPrice: 75.2,
      contracts: 1,
    });
    expect(r.netPnl).toBe(-200);
    expect(r.rMultiple).toBe(-1);
  });

  it("open trade (no exit) has no P&L yet", () => {
    const r = computeTrade(inst("ES"), {
      kind: "taken",
      direction: "long",
      entryAt: T0,
      entryPrice: 5000,
      contracts: 1,
    });
    expect(r.ticks).toBeNull();
    expect(r.grossPnl).toBeNull();
    expect(r.durationSec).toBeNull();
  });

  it("observed moves measure ticks but never money", () => {
    const r = computeTrade(inst("ES", 4.5), {
      kind: "observed",
      direction: "long",
      entryAt: T0,
      exitAt: "2026-09-15T13:45:00Z",
      entryPrice: 5000,
      exitPrice: 5020,
    });
    expect(r.ticks).toBe(80);
    expect(r.grossPnl).toBeNull();
    expect(r.feesTotal).toBeNull();
    expect(r.rMultiple).toBeNull();
    expect(r.durationSec).toBe(300);
  });

  it("missed trades compute hypothetical P&L (what was left on the table)", () => {
    const r = computeTrade(inst("ES"), {
      kind: "missed",
      direction: "long",
      entryAt: T0,
      entryPrice: 5000,
      exitPrice: 5010,
      stopPrice: 4997.5,
      contracts: 1,
    });
    expect(r.netPnl).toBe(500);
    expect(r.rMultiple).toBe(4);
  });
});
