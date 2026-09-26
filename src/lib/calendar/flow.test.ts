import { describe, expect, it } from "vitest";

import { generateFlowEvents, lastBusinessDay, monthlyOpex, thirdFriday, vixExpiry } from "./flow";
import { DEFAULT_HOLIDAYS, HolidayCalendar, type Holiday } from "./holidays";

// Published 2024–2025 US holidays needed for historical checks.
const PAST: Holiday[] = [
  { market: "US", date: "2024-06-19", name: "Juneteenth", earlyClose: null },
  { market: "US", date: "2025-01-01", name: "New Year's Day", earlyClose: null },
  { market: "US", date: "2025-04-18", name: "Good Friday", earlyClose: null },
  { market: "US", date: "2025-06-19", name: "Juneteenth", earlyClose: null },
];
const cal = new HolidayCalendar([...DEFAULT_HOLIDAYS, ...PAST]);

describe("monthly OPEX", () => {
  it("is the third Friday", () => {
    expect(thirdFriday(2026, 9)).toBe("2026-09-18");
    expect(thirdFriday(2026, 5)).toBe("2026-05-15");
    expect(thirdFriday(2027, 1)).toBe("2027-01-15");
  });

  it("matches the 2026 standard expiration calendar, Thursday when Friday is a holiday", () => {
    const got = Array.from({ length: 12 }, (_, i) => monthlyOpex(2026, i + 1, cal));
    expect(got).toEqual([
      "2026-01-16",
      "2026-02-20",
      "2026-03-20",
      "2026-04-17",
      "2026-05-15",
      "2026-06-18", // Juneteenth Friday
      "2026-07-17",
      "2026-08-21",
      "2026-09-18",
      "2026-10-16",
      "2026-11-20",
      "2026-12-18",
    ]);
    expect(monthlyOpex(2025, 4, cal)).toBe("2025-04-17"); // Good Friday 2025
  });
});

describe("VIX expiration (Cboe rule)", () => {
  it("matches the published 2025 dates", () => {
    const got = Array.from({ length: 12 }, (_, i) => vixExpiry(2025, i + 1, cal));
    expect(got).toEqual([
      "2025-01-22",
      "2025-02-19",
      "2025-03-18", // Tuesday: April SPX expiry moved for Good Friday
      "2025-04-16",
      "2025-05-21",
      "2025-06-18",
      "2025-07-16",
      "2025-08-20",
      "2025-09-17",
      "2025-10-22",
      "2025-11-19",
      "2025-12-17",
    ]);
  });

  it("matches the published 2026 dates", () => {
    const got = Array.from({ length: 12 }, (_, i) => vixExpiry(2026, i + 1, cal));
    expect(got).toEqual([
      "2026-01-21",
      "2026-02-18",
      "2026-03-18",
      "2026-04-15",
      "2026-05-19", // Tuesday: June SPX expiry moved for Juneteenth
      "2026-06-17",
      "2026-07-22",
      "2026-08-19",
      "2026-09-16",
      "2026-10-21",
      "2026-11-18",
      "2026-12-16",
    ]);
  });

  it("moves to the prior business day when the Wednesday itself is a holiday", () => {
    expect(vixExpiry(2024, 6, cal)).toBe("2024-06-18"); // Juneteenth 2024 was a Wednesday
  });

  it("applies the 2027 Juneteenth shift", () => {
    expect(vixExpiry(2027, 5, cal)).toBe("2027-05-18");
  });
});

describe("month / quarter / year end", () => {
  it("uses each market's own business days", () => {
    expect(lastBusinessDay(2026, 8, cal, "US")).toBe("2026-08-31");
    expect(lastBusinessDay(2026, 8, cal, "UK")).toBe("2026-08-28"); // Summer bank holiday
    expect(lastBusinessDay(2026, 10, cal, "US")).toBe("2026-10-30"); // 31st is a Saturday
  });

  it("generates keyed, correctly timed events across UK DST", () => {
    const ev = generateFlowEvents(2026, 8, 5, cal);
    const byKey = new Map(ev.map((e) => [e.generator_key, e]));
    expect(ev).toHaveLength(20);

    expect(byKey.get("fix:2026-08")!.starts_at).toBe("2026-08-28T15:00:00.000Z"); // BST
    expect(byKey.get("fix:2026-11")!.starts_at).toBe("2026-11-30T16:00:00.000Z"); // GMT
    expect(byKey.get("fix:2026-09")!.title).toBe("Quarter-end — London 4pm fix");
    expect(byKey.get("fix:2026-09")!.importance).toBe(3);
    expect(byKey.get("monthend:2026-12")!.title).toBe("Year-end — US close rebalancing");
    expect(byKey.get("monthend:2026-12")!.starts_at).toBe("2026-12-31T21:00:00.000Z");

    expect(byKey.get("opex:2026-09")!.title).toBe("Quad witching (quarterly OPEX)");
    expect(byKey.get("opex:2026-10")!.title).toBe("Monthly OPEX");
    expect(byKey.get("opex:2026-10")!.starts_at).toBe("2026-10-16T13:30:00.000Z");
    expect(ev.every((e) => e.primary_domain === "FLOW" && e.source === "generated")).toBe(true);
  });

  it("flags OPEX moved by a holiday", () => {
    const june = generateFlowEvents(2026, 6, 1, cal).find(
      (e) => e.generator_key === "opex:2026-06",
    );
    expect(june!.starts_at).toBe("2026-06-18T13:30:00.000Z");
    expect(june!.notes).toMatch(/holiday/);
  });

  it("puts the month-end close on an early-close day at the early close", () => {
    const early = new HolidayCalendar([
      { market: "US", date: "2027-12-31", name: "Test early close", earlyClose: "13:00" },
    ]);
    const dec = generateFlowEvents(2027, 12, 1, early).find(
      (e) => e.generator_key === "monthend:2027-12",
    );
    expect(dec!.starts_at).toBe("2027-12-31T18:00:00.000Z");
  });
});
