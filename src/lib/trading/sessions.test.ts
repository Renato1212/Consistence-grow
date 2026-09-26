import { describe, expect, it } from "vitest";

import { isoWeekday, sessionFor, timeBucket } from "./sessions";

const CHI = "America/Chicago";
const BERLIN = "Europe/Berlin";

// 2026 DST: US 8 Mar → 1 Nov; EU 29 Mar → 25 Oct.
describe("sessionFor", () => {
  it.each([
    // Winter, both sides standard time. US 08:00 NY = 13:00Z; EU 07:00 London = 07:00Z
    ["2026-01-15T06:59:00Z", "ASIA"],
    ["2026-01-15T07:00:00Z", "EU"],
    ["2026-01-15T12:59:00Z", "EU"],
    ["2026-01-15T13:00:00Z", "US"],
    ["2026-01-15T21:59:00Z", "US"], // 16:59 NY
    ["2026-01-15T22:00:00Z", "ASIA"], // 17:00 NY
    // March US-only DST gap: US 08:00 NY = 12:00Z, London still GMT
    ["2026-03-20T11:59:00Z", "EU"],
    ["2026-03-20T12:00:00Z", "US"],
    // Summer both DST: EU 07:00 BST = 06:00Z, US 08:00 EDT = 12:00Z
    ["2026-07-01T05:59:00Z", "ASIA"],
    ["2026-07-01T06:00:00Z", "EU"],
    ["2026-07-01T12:00:00Z", "US"],
    // Late-October EU-only gap: London GMT (07:00Z), NY still EDT (12:00Z)
    ["2026-10-28T06:30:00Z", "ASIA"],
    ["2026-10-28T07:00:00Z", "EU"],
    ["2026-10-28T12:00:00Z", "US"],
    // Late evening NY → overnight Asia even though London date has rolled
    ["2026-01-16T03:00:00Z", "ASIA"],
  ])("%s → %s", (iso, expected) => {
    expect(sessionFor(iso)).toBe(expected);
  });
});

describe("timeBucket (exchange time)", () => {
  it("buckets CME trades in Chicago time across US DST", () => {
    // 09:30 NY cash open = 08:30 Chicago, winter and summer
    expect(timeBucket("2026-01-15T14:30:00Z", CHI)).toBe("08:30");
    expect(timeBucket("2026-07-01T13:30:00Z", CHI)).toBe("08:30");
    expect(timeBucket("2026-07-01T13:59:59Z", CHI)).toBe("08:30");
    expect(timeBucket("2026-07-01T14:00:00Z", CHI)).toBe("09:00");
  });

  it("buckets Eurex trades in Frankfurt time", () => {
    expect(timeBucket("2026-01-15T08:05:00Z", BERLIN)).toBe("09:00");
    expect(timeBucket("2026-07-01T07:45:00Z", BERLIN)).toBe("09:30");
  });
});

describe("isoWeekday (exchange time)", () => {
  it("uses the exchange date, not UTC", () => {
    // Sunday 17:30 Chicago (globex open) = Sunday 23:30Z winter
    expect(isoWeekday("2026-01-18T23:30:00Z", CHI)).toBe(7);
    // Monday 00:30Z is still Sunday in Chicago
    expect(isoWeekday("2026-01-19T00:30:00Z", CHI)).toBe(7);
    expect(isoWeekday("2026-01-19T15:00:00Z", CHI)).toBe(1);
  });
});
