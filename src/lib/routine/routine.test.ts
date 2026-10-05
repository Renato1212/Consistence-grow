import { describe, expect, it } from "vitest";

import { HolidayCalendar } from "@/lib/calendar/holidays";
import { formatInTz } from "@/lib/time";

import { scalpBias } from "./bias";
import { defaultRoutine, parseRoutine, routineSchema, setupPlaybookIds } from "./routine";
import {
  blockStatuses,
  blocksForDay,
  blockUsage,
  dayStopped,
  focusBlock,
  qualifyingEvents,
  tradesInBlock,
} from "./schedule";

const PB = {
  euNews: "11111111-1111-4111-8111-111111111111",
  usOpen: "22222222-2222-4222-8222-222222222222",
  scalp: "33333333-3333-4333-8333-333333333333",
  moc: "44444444-4444-4444-8444-444444444444",
};
const routine = defaultRoutine(PB);
const lisbon = (iso: string) => formatInTz(iso, "Europe/Lisbon", "HH:mm");
const byKey = (date: string, cal?: HolidayCalendar) =>
  Object.fromEntries(blocksForDay(routine, date, cal).map((b) => [b.key, b]));

describe("default routine", () => {
  it("is valid and links the four setups in order", () => {
    expect(routineSchema.safeParse(routine).success).toBe(true);
    expect(setupPlaybookIds(routine)).toEqual([PB.euNews, PB.usOpen, PB.scalp, PB.moc]);
  });

  it("falls back to the default for invalid data", () => {
    expect(parseRoutine({ version: 2 })).toEqual(defaultRoutine());
    const bad = structuredClone(routine);
    bad.blocks[0].start = "25:00";
    expect(parseRoutine(bad).blocks[0].start).toBe("07:15");
  });

  it("rejects duplicate keys and inverted windows", () => {
    const dup = structuredClone(routine);
    dup.blocks[1].key = dup.blocks[0].key;
    expect(routineSchema.safeParse(dup).success).toBe(false);
    const inv = structuredClone(routine);
    inv.blocks[0].end = "07:00";
    expect(routineSchema.safeParse(inv).success).toBe(false);
  });
});

describe("blocksForDay (Lisbon times)", () => {
  it("matches the trader's times on a normal day", () => {
    const b = byKey("2026-10-05");
    expect(lisbon(b.eu_prep.startAt)).toBe("07:15");
    expect(lisbon(b.eu_news.startAt)).toBe("08:00");
    expect(lisbon(b.us_open.startAt)).toBe("14:30");
    expect(lisbon(b.us_scalp.startAt)).toBe("17:00");
    expect(lisbon(b.us_scalp.endAt)).toBe("20:00");
    expect(lisbon(b.moc.startAt)).toBe("20:50");
  });

  it("moves the US blocks one hour earlier when only Europe has changed its clocks", () => {
    // 26 Oct 2026: Europe on winter time, New York still on daylight time.
    const autumn = byKey("2026-10-26");
    expect(lisbon(autumn.eu_news.startAt)).toBe("08:00");
    expect(lisbon(autumn.us_open.startAt)).toBe("13:30");
    expect(lisbon(autumn.us_scalp.startAt)).toBe("16:00");
    expect(lisbon(autumn.moc.startAt)).toBe("19:50");
    // 16 Mar 2026: New York on daylight time, Europe not yet.
    const spring = byKey("2026-03-16");
    expect(lisbon(spring.moc.startAt)).toBe("19:50");
    // After both changed.
    expect(lisbon(byKey("2026-11-02").moc.startAt)).toBe("20:50");
  });

  it("skips weekends, closed markets and blocks after an early close", () => {
    expect(blocksForDay(routine, "2026-10-03")).toEqual([]);
    const cal = new HolidayCalendar([
      { market: "US", date: "2026-11-26", name: "Thanksgiving", earlyClose: null },
      { market: "US", date: "2026-11-27", name: "Day after Thanksgiving", earlyClose: "13:00" },
    ]);
    const thanksgiving = byKey("2026-11-26", cal);
    expect(Object.keys(thanksgiving)).toEqual(["eu_prep", "eu_news"]);
    const early = byKey("2026-11-27", cal);
    expect(early.moc).toBeUndefined();
    expect(early.us_scalp.clipped).toBe(true);
    expect(lisbon(early.us_scalp.endAt)).toBe("18:00");
  });
});

describe("statuses and focus", () => {
  const blocks = blocksForDay(routine, "2026-10-05");
  it("marks now / next / past", () => {
    const st = blockStatuses(blocks, new Date("2026-10-05T16:30:00Z")); // 17:30 Lisbon
    expect(st.get("us_open")).toBe("past");
    expect(st.get("us_scalp")).toBe("now");
    expect(st.get("moc")).toBe("next");
    expect(st.get("debrief")).toBe("later");
    expect(focusBlock(blocks, new Date("2026-10-05T16:30:00Z"))?.key).toBe("us_scalp");
    expect(focusBlock(blocks, new Date("2026-10-05T15:00:00Z"))?.key).toBe("us_scalp"); // gap → next
    expect(focusBlock(blocks, new Date("2026-10-05T23:00:00Z"))?.key).toBe("debrief");
  });
});

describe("news gate", () => {
  it("keeps high-importance events inside the window only", () => {
    const eu = blocksForDay(routine, "2026-10-05").find((b) => b.key === "eu_news")!;
    const events = [
      { id: "a", title: "German CPI", startsAt: "2026-10-05T08:00:00Z", importance: 3 },
      { id: "b", title: "Minor", startsAt: "2026-10-05T09:00:00Z", importance: 2 },
      { id: "c", title: "US CPI", startsAt: "2026-10-05T12:30:00Z", importance: 3 },
      { id: "d", title: "Early", startsAt: "2026-10-05T06:00:00Z", importance: 3 },
    ];
    expect(qualifyingEvents(eu, events, 3).map((e) => e.id)).toEqual(["a"]);
    expect(qualifyingEvents(eu, events, 2).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("guardrails", () => {
  const blocks = blocksForDay(routine, "2026-10-05");
  const scalp = blocks.find((b) => b.key === "us_scalp")!;
  const t = (id: string, pb: string | null, at: string, net: number, est = false) => ({
    id,
    playbookId: pb,
    entryAt: at,
    timeEstimated: est,
    net,
  });
  const trades = [
    t("1", PB.scalp, "2026-10-05T16:10:00Z", -50),
    t("2", null, "2026-10-05T17:00:00Z", 20), // inside the window, no setup
    t("3", null, "2026-10-05T17:00:00Z", 20, true), // estimated time → not counted
    t("4", PB.moc, "2026-10-05T16:20:00Z", 10), // other setup
  ];

  it("counts trades by setup, or by time when no setup is set", () => {
    expect(tradesInBlock(scalp, trades).map((x) => x.id)).toEqual(["1", "2"]);
    expect(blockUsage(scalp, trades)).toMatchObject({
      trades: 2,
      net: -30,
      tradesLeft: 4,
      stopped: false,
    });
  });

  it("stops a block at its trade or loss limit and the day at its stop", () => {
    expect(blockUsage({ ...scalp, maxTrades: 2 }, trades)).toMatchObject({
      stopped: true,
      reason: "trades",
    });
    expect(blockUsage({ ...scalp, maxTrades: null, maxLossUsd: 30 }, trades)).toMatchObject({
      lossLeft: 0,
      stopped: true,
      reason: "loss",
    });
    expect(dayStopped({ ...routine, dayMaxLossUsd: 25 }, trades)).toBe(false); // net 0
    expect(dayStopped({ ...routine, dayMaxLossUsd: 25 }, [trades[0]])).toBe(true);
  });
});

describe("scalp bias", () => {
  it("turns the 3 taps into a side and a plan", () => {
    expect(scalpBias({})).toBeNull();
    expect(scalpBias({ side: "unclear", trend: "yes" })?.side).toBeNull();
    expect(scalpBias({ side: "long", trend: "yes", htf: "yes" })).toMatchObject({
      side: "long",
      text: expect.stringContaining("let winners run"),
    });
    expect(scalpBias({ side: "short", trend: "yes", htf: "no" })?.text).toContain(
      "short scalps only",
    );
    expect(scalpBias({ side: "short", trend: "no" })?.text).toContain("No trend");
  });
});
