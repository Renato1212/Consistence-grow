import { describe, expect, it } from "vitest";

import { formatTreasuryPrice, parseTreasuryPrice } from "./treasury";

const ok = (raw: string, tick?: number) => {
  const r = parseTreasuryPrice(raw, tick);
  if (!r.ok) throw new Error(`${raw}: ${r.error}`);
  return r.value;
};

describe("parseTreasuryPrice", () => {
  it.each([
    ["110'16", 110.5],
    ["110-16", 110.5],
    ["110 16", 110.5],
    ["110'00", 110],
    ["110'16.5", 110.515625],
    ["110-16.5", 110.515625],
    ["110'165", 110.515625],
    ["110'16+", 110.515625],
    ["110'162", 110 + 16.25 / 32],
    ["110'167", 110 + 16.75 / 32],
    ["110'16.25", 110 + 16.25 / 32],
    ["103'161", 103 + 16.125 / 32],
    ["103'163", 103 + 16.375 / 32],
    ["103'168", 103 + 16.875 / 32],
    ["110.515625", 110.515625],
    ["118", 118],
    ["  110'16  ", 110.5],
  ])("%s → %d", (raw, expected) => {
    expect(ok(raw)).toBeCloseTo(expected, 12);
  });

  it.each([
    "",
    "abc",
    "110'32",
    "110'324",
    "110'164",
    "110'169",
    "110'1655",
    "110''16",
    "110'165+",
  ])("rejects %j", (raw) => {
    expect(parseTreasuryPrice(raw).ok).toBe(false);
  });

  it("validates against the contract tick", () => {
    expect(parseTreasuryPrice("110'16.5", 1 / 64).ok).toBe(true); // ZN half 32nds
    expect(parseTreasuryPrice("110'16.25", 1 / 64).ok).toBe(false); // quarter not valid for ZN
    expect(parseTreasuryPrice("110'16.25", 1 / 128).ok).toBe(true); // ZF quarters
    expect(parseTreasuryPrice("103'16.125", 1 / 256).ok).toBe(true); // ZT eighths
    expect(parseTreasuryPrice("118'16.5", 1 / 32).ok).toBe(false); // ZB whole 32nds only
  });
});

describe("formatTreasuryPrice", () => {
  it("formats whole 32nds for ZB/UB", () => {
    expect(formatTreasuryPrice(118.5, 1 / 32)).toBe("118'16");
    expect(formatTreasuryPrice(118, 1 / 32)).toBe("118'00");
    expect(formatTreasuryPrice(118 + 3 / 32, 1 / 32)).toBe("118'03");
  });

  it("formats 3-digit CME style for finer ticks", () => {
    expect(formatTreasuryPrice(110.515625, 1 / 64)).toBe("110'165");
    expect(formatTreasuryPrice(110.5, 1 / 64)).toBe("110'160");
    expect(formatTreasuryPrice(108 + 16.75 / 32, 1 / 128)).toBe("108'167");
    expect(formatTreasuryPrice(103 + 16.125 / 32, 1 / 256)).toBe("103'161");
  });

  it("round-trips every tick of a point for ZT, ZF, ZN, ZB", () => {
    for (const tick of [1 / 256, 1 / 128, 1 / 64, 1 / 32]) {
      for (let i = 0; i < 1 / tick; i++) {
        const value = 110 + i * tick;
        const text = formatTreasuryPrice(value, tick);
        expect(ok(text, tick)).toBeCloseTo(value, 12);
      }
    }
  });
});
