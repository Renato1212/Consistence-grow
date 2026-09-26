import { describe, expect, it } from "vitest";

import { TZ, dateInTz, formatInTz, zonedWallTimeToUtc } from "./time";

// 2026 DST transitions:
//   US (New York)   : 8 Mar  → EDT (UTC-4),  1 Nov → EST (UTC-5)
//   EU (Lisbon/LDN) : 29 Mar → WEST/BST (+1), 25 Oct → WET/GMT (+0)
describe("time utils across DST", () => {
  it("US cash open 09:30 NY is 14:30 Lisbon in normal winter time", () => {
    const open = zonedWallTimeToUtc("2026-01-15 09:30", TZ.newYork);
    expect(open.toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(formatInTz(open, TZ.lisbon, "HH:mm")).toBe("14:30");
  });

  it("US cash open is 13:30 Lisbon during the March US-only DST gap", () => {
    const open = zonedWallTimeToUtc("2026-03-20 09:30", TZ.newYork);
    expect(open.toISOString()).toBe("2026-03-20T13:30:00.000Z");
    expect(formatInTz(open, TZ.lisbon, "HH:mm")).toBe("13:30");
  });

  it("US cash open is back to 14:30 Lisbon once both sides are on summer time", () => {
    const open = zonedWallTimeToUtc("2026-04-01 09:30", TZ.newYork);
    expect(open.toISOString()).toBe("2026-04-01T13:30:00.000Z");
    expect(formatInTz(open, TZ.lisbon, "HH:mm")).toBe("14:30");
  });

  it("US cash open is 13:30 Lisbon during the late-October EU-only gap", () => {
    const open = zonedWallTimeToUtc("2026-10-28 09:30", TZ.newYork);
    expect(open.toISOString()).toBe("2026-10-28T13:30:00.000Z");
    expect(formatInTz(open, TZ.lisbon, "HH:mm")).toBe("13:30");
  });

  it("London fixing 16:00 is 16:00 Lisbon (same offset year-round)", () => {
    for (const day of ["2026-01-30", "2026-06-30", "2026-10-30"]) {
      const fix = zonedWallTimeToUtc(`${day} 16:00`, TZ.london);
      expect(formatInTz(fix, TZ.lisbon, "HH:mm")).toBe("16:00");
    }
  });

  it("Lisbon calendar date differs from UTC date around midnight in summer", () => {
    // 23:30 UTC on 30 Jun is 00:30 on 1 Jul in Lisbon (WEST, UTC+1).
    expect(dateInTz("2026-06-30T23:30:00Z", TZ.lisbon)).toBe("2026-07-01");
    // In winter Lisbon equals UTC.
    expect(dateInTz("2026-01-30T23:30:00Z", TZ.lisbon)).toBe("2026-01-30");
  });
});
