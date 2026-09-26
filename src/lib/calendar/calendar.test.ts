import { describe, expect, it } from "vitest";

import { addDays, addMonths, isIsoDate, isoWeekday, startOfIsoWeek } from "./dates";
import { DEFAULT_HOLIDAYS, HolidayCalendar } from "./holidays";
import { sessionMarkers } from "./markers";
import { PRESETS, presetByKey, presetEvents } from "./presets";
import { expandTemplates, type CalendarTemplate } from "./templates";

const cal = new HolidayCalendar(DEFAULT_HOLIDAYS);

describe("date helpers", () => {
  it("does calendar arithmetic without DST drift", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(isoWeekday("2026-09-26")).toBe(6);
    expect(startOfIsoWeek("2026-09-27")).toBe("2026-09-21");
    expect(addMonths(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });
});

describe("holidays", () => {
  it("knows closures and early closes", () => {
    expect(cal.isClosed("2026-11-26", "US")).toBe(true);
    expect(cal.isClosed("2026-11-27", "US")).toBe(false);
    expect(cal.earlyClose("2026-11-27", "US")).toBe("13:00");
    expect(cal.isBusinessDay("2026-08-31", "UK")).toBe(false);
    expect(cal.isBusinessDay("2026-08-31", "US")).toBe(true);
    expect(cal.lastYear("US")).toBe(2027);
  });
});

describe("session markers", () => {
  it("shifts with US DST before Europe changes (Mar 2026)", () => {
    const m = sessionMarkers("2026-03-10", cal);
    const at = Object.fromEntries(m.map((x) => [x.key, x.at]));
    expect(at.us_open).toBe("2026-03-10T13:30:00.000Z"); // 13:30 Lisbon, not 14:30
    expect(at.eu_open).toBe("2026-03-10T08:00:00.000Z");
    expect(at.moc).toBe("2026-03-10T19:50:00.000Z");
    expect(at.us_close).toBe("2026-03-10T20:00:00.000Z");
  });

  it("uses the early close and skips US markers on holidays and weekends", () => {
    const early = Object.fromEntries(sessionMarkers("2026-11-27", cal).map((x) => [x.key, x]));
    expect(early.us_close.at).toBe("2026-11-27T18:00:00.000Z");
    expect(early.us_close.label).toMatch(/early/);
    expect(early.moc.at).toBe("2026-11-27T17:50:00.000Z");
    expect(sessionMarkers("2026-11-26", cal).map((x) => x.key)).toEqual(["eu_open"]);
    expect(sessionMarkers("2026-09-26", cal)).toEqual([]);
  });
});

describe("presets", () => {
  it("have unique keys and valid times", () => {
    const keys = PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PRESETS) for (const part of p.parts) expect(part.time).toMatch(/^\d\d:\d\d$/);
  });

  it("convert native times to UTC across DST", () => {
    const [cpi] = presetEvents(presetByKey("cpi")!, "2026-10-14");
    expect(cpi.starts_at).toBe("2026-10-14T12:30:00.000Z");
    expect(cpi.importance).toBe(3);
    expect(cpi.primary_domain).toBe("DATA");

    const ecb = presetEvents(presetByKey("ecb")!, "2026-10-29"); // after EU DST ends
    expect(ecb.map((e) => e.starts_at)).toEqual([
      "2026-10-29T13:15:00.000Z",
      "2026-10-29T13:45:00.000Z",
    ]);
    const fomc = presetEvents(presetByKey("fomc")!, "2026-12-09");
    expect(fomc.map((e) => e.title)).toEqual(["FOMC rate decision", "FOMC press conference"]);
    expect(fomc[0].starts_at).toBe("2026-12-09T19:00:00.000Z");
  });
});

describe("recurring templates", () => {
  const eia: CalendarTemplate = {
    id: "t1",
    title: "EIA crude inventories",
    category: "Energy inventories",
    primaryDomain: "DATA",
    importance: 2,
    instruments: ["CL"],
    weekday: 3,
    localTime: "10:30:00",
    tz: "America/New_York",
    active: true,
  };

  it("expands weekly occurrences in the window with stable keys", () => {
    const ev = expandTemplates([eia], "2026-09-14", "2026-10-01", cal);
    expect(ev.map((e) => e.generator_key)).toEqual([
      "tpl:t1:2026-09-16",
      "tpl:t1:2026-09-23",
      "tpl:t1:2026-09-30",
    ]);
    expect(ev[0].starts_at).toBe("2026-09-16T14:30:00.000Z");
    expect(ev[0].notes).toBeNull();
  });

  it("flags holiday weeks, skips holidays and inactive templates", () => {
    const labor = expandTemplates([eia], "2026-09-07", "2026-09-12", cal);
    expect(labor).toHaveLength(1);
    expect(labor[0].notes).toMatch(/Holiday week/);
    const thanksgiving = expandTemplates([{ ...eia, weekday: 4 }], "2026-11-23", "2026-11-28", cal);
    expect(thanksgiving).toHaveLength(0);
    expect(expandTemplates([{ ...eia, active: false }], "2026-09-14", "2026-10-01", cal)).toEqual(
      [],
    );
  });
});
