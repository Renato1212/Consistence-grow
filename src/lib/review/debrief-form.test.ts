import { describe, expect, it } from "vitest";

import {
  completionIssues,
  debriefRowToSnapshot,
  emptyDebrief,
  slots,
  toDebriefPayload,
} from "./debrief-form";

describe("debrief form", () => {
  it("requires three grades and a note on every broken rule to complete", () => {
    const s = {
      ...emptyDebrief("d", "2026-09-28"),
      gradeContext: "A" as const,
      rules: { r1: { followed: false, note: "" }, r2: { followed: true, note: "" } },
    };
    expect(completionIssues(s, { r1: "Be flat before news" })).toEqual([
      "Edge grade",
      "Process grade",
      'note for broken rule "Be flat before news"',
    ]);
    const ok = {
      ...s,
      gradeEdge: "B" as const,
      gradeProcess: "C" as const,
      rules: { r1: { followed: false, note: "Held through CPI" } },
    };
    expect(completionIssues(ok, {})).toEqual([]);
  });

  it("builds the RPC payload: trimmed bullets (max 3), unchecked rules omitted, empty items kept by id", () => {
    const p = toDebriefPayload({
      ...emptyDebrief("d", "2026-09-28"),
      wentWell: [" patience ", "", "sizing", "extra"],
      toImprove: ["", "", ""],
      lesson: "  Wait for the retest ",
      scenarios: { s1: { outcome: "partial", traded: true } },
      levels: { l1: { tested: true, respected: false } },
      rules: { r1: { followed: null, note: "" }, r2: { followed: false, note: " late " } },
      actions: [{ id: "a1", text: " Review CPI plan ", showInPrep: true, status: "open" }],
    });
    expect(p).toMatchObject({
      went_well: ["patience", "sizing", "extra"],
      to_improve: [],
      lesson: "Wait for the retest",
      scenarios: [{ id: "s1", outcome: "partial", traded: true }],
      levels: [{ id: "l1", tested: true, respected: false }],
      rule_checks: [{ rule_id: "r2", followed: false, note: "late" }],
      action_items: [{ id: "a1", text: "Review CPI plan", show_in_prep: true, status: "open" }],
    });
  });

  it("maps rows back with three editable bullet slots", () => {
    expect(slots(["a"])).toEqual(["a", "", ""]);
    const snap = debriefRowToSnapshot(
      {
        id: "d1",
        grade_context: "B",
        grade_context_note: null,
        grade_edge: null,
        grade_edge_note: null,
        grade_process: "A",
        grade_process_note: "calm",
        went_well: ["x"],
        to_improve: [],
        lesson: null,
        mood: 4,
        energy: null,
        completed_at: null,
      },
      "unused",
      "2026-09-28",
      {
        scenarios: [{ id: "s", outcome: "played", traded: false }],
        levels: [],
        rules: [{ rule_id: "r", followed: false, note: "why" }],
        actions: [{ id: "a", text: "t", show_in_prep: false, status: "done" }],
      },
    );
    expect(snap).toMatchObject({
      id: "d1",
      gradeContext: "B",
      wentWell: ["x", "", ""],
      scenarios: { s: { outcome: "played", traded: false } },
      rules: { r: { followed: false, note: "why" } },
      actions: [{ id: "a", status: "done", showInPrep: false }],
    });
    expect(
      debriefRowToSnapshot(null, "new", "2026-09-28", {
        scenarios: [],
        levels: [],
        rules: [],
        actions: [],
      }).id,
    ).toBe("new");
  });
});
