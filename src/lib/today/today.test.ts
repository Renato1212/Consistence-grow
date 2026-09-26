import { describe, expect, it } from "vitest";

import { DEFAULT_HOLIDAYS, HolidayCalendar } from "@/lib/calendar/holidays";
import { bannerEvent, fmtCountdown } from "./banner";
import { currentPrepSession, todayState } from "./state";

const cal = new HolidayCalendar(DEFAULT_HOLIDAYS);
const at = (iso: string) => new Date(iso);

describe("todayState", () => {
  it("walks a normal day (Lisbon WEST, NY EDT: US starts 13:00 Lisbon)", () => {
    const phase = (iso: string) => todayState(at(iso), cal).phase;
    expect(phase("2026-09-28T05:30:00Z")).toBe("pre_eu"); // 06:30 Lisbon
    expect(phase("2026-09-28T07:00:00Z")).toBe("eu"); // 08:00 Lisbon
    expect(phase("2026-09-28T11:59:00Z")).toBe("eu"); // 12:59 Lisbon
    expect(phase("2026-09-28T12:00:00Z")).toBe("us"); // 08:00 NY
    expect(phase("2026-09-28T19:59:00Z")).toBe("us");
    expect(phase("2026-09-28T20:00:00Z")).toBe("post"); // 16:00 NY
  });

  it("handles the March gap when the US is on DST and Europe is not", () => {
    // 08:00 EDT = 12:00Z = 12:00 Lisbon (WET) — an hour earlier than usual.
    const s = todayState(at("2026-03-10T12:00:00Z"), cal);
    expect(s.phase).toBe("us");
    expect(s.usStart).toBe("2026-03-10T12:00:00.000Z");
    expect(todayState(at("2026-03-10T11:59:00Z"), cal).phase).toBe("eu");
  });

  it("is closed on weekends and when both markets are shut", () => {
    expect(todayState(at("2026-09-26T10:00:00Z"), cal).phase).toBe("closed");
    expect(todayState(at("2026-12-25T10:00:00Z"), cal).phase).toBe("closed");
  });

  it("runs EU only on a US holiday", () => {
    const s = todayState(at("2026-09-07T13:00:00Z"), cal); // Labor Day, 14:00 Lisbon
    expect(s.phase).toBe("eu");
    expect(s.usHoliday).toBe("Labor Day");
    expect(currentPrepSession(s)).toBe("EU");
    expect(todayState(at("2026-09-07T16:00:00Z"), cal).phase).toBe("post"); // after 17:30 CET
  });

  it("ends the US session at the early close", () => {
    const s = todayState(at("2026-11-27T18:30:00Z"), cal);
    expect(s.phase).toBe("post");
    expect(s.usEarlyClose).toBe("13:00");
    expect(todayState(at("2026-11-27T17:30:00Z"), cal).phase).toBe("us");
  });

  it("picks the prep for the P shortcut", () => {
    expect(currentPrepSession(todayState(at("2026-09-28T09:00:00Z"), cal))).toBe("EU");
    expect(currentPrepSession(todayState(at("2026-09-28T14:00:00Z"), cal))).toBe("US");
  });
});

describe("be-flat banner", () => {
  const now = Date.parse("2026-10-14T12:22:00Z");
  const events = [
    { id: "cpi", title: "CPI", startsAt: "2026-10-14T12:30:00Z", importance: 3 },
    { id: "low", title: "Claims", startsAt: "2026-10-14T12:25:00Z", importance: 2 },
    { id: "past", title: "Old", startsAt: "2026-10-14T12:20:00Z", importance: 3 },
  ];

  it("shows the next high-importance event within N minutes", () => {
    expect(bannerEvent(now, events, 10)).toEqual({ event: events[0], secondsLeft: 480 });
    expect(bannerEvent(now, events, 5)).toBeNull();
    expect(bannerEvent(now, events, 0)).toBeNull();
  });

  it("disappears once the event starts", () => {
    expect(bannerEvent(Date.parse("2026-10-14T12:30:00Z"), events, 10)).toBeNull();
  });

  it("formats the countdown rounding minutes up", () => {
    expect(fmtCountdown(480)).toBe("8 min");
    expect(fmtCountdown(61)).toBe("2 min");
    expect(fmtCountdown(45)).toBe("45 s");
  });
});
