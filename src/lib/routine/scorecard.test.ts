import { describe, expect, it } from "vitest";

import { adherence, parseSetupNotes, setupStats } from "./scorecard";

const t = (net: number | null, r: number | null) => ({
  playbookId: "p",
  tradeDate: "2026-10-05",
  net,
  r,
});

describe("setupStats", () => {
  it("counts wins over decided trades and averages R with an interval", () => {
    const s = setupStats([t(100, 1), t(-50, -0.5), t(0, 0), t(200, 2), t(null, null)]);
    expect(s).toMatchObject({ n: 5, wins: 2, rN: 4, net: 250 });
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.avgR).toBeCloseTo(0.625);
    expect(s.winCI!.lo).toBeLessThan(s.winRate!);
    expect(s.winCI!.hi).toBeGreaterThan(s.winRate!);
    expect(s.avgRCI!.lo).toBeLessThanOrEqual(s.avgR!);
  });

  it("is empty-safe", () => {
    expect(setupStats([])).toMatchObject({
      n: 0,
      winRate: null,
      winCI: null,
      avgR: null,
      avgRCI: null,
    });
  });
});

describe("adherence and notes", () => {
  it("counts answers only", () => {
    expect(adherence(["yes", "partly", null, "no", "yes"])).toEqual({
      yes: 2,
      partly: 1,
      no: 1,
      answered: 4,
    });
  });

  it("parses stored notes defensively", () => {
    expect(
      parseSetupNotes({ a: { verdict: "keep", note: "fine" }, b: { verdict: "x" }, c: 3 }),
    ).toEqual({ a: { verdict: "keep", note: "fine" }, b: { verdict: null, note: "" } });
    expect(parseSetupNotes(null)).toEqual({});
  });
});
