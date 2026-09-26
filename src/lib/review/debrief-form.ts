/**
 * Daily debrief form model: one snapshot autosaved through the
 * `save_debrief` RPC (debrief + plan vs reality + rule checks + action items).
 */
export const GRADES = ["A", "B", "C", "F"] as const;
export type Grade = (typeof GRADES)[number];
export const MAX_BULLETS = 3;

export type Outcome = "played" | "partial" | "didnt";
export const OUTCOME_LABEL: Record<Outcome, string> = {
  played: "Played out",
  partial: "Partially",
  didnt: "Didn't happen",
};

export type ActionDraft = {
  id: string;
  text: string;
  showInPrep: boolean;
  status: "open" | "done" | "dropped";
};

export type DebriefSnapshot = {
  id: string;
  date: string;
  gradeContext: Grade | null;
  gradeContextNote: string;
  gradeEdge: Grade | null;
  gradeEdgeNote: string;
  gradeProcess: Grade | null;
  gradeProcessNote: string;
  wentWell: string[]; // always MAX_BULLETS slots in the UI
  toImprove: string[];
  lesson: string;
  mood: number | null;
  energy: number | null;
  completedAt: string | null;
  scenarios: Record<string, { outcome: Outcome | null; traded: boolean | null }>;
  levels: Record<string, { tested: boolean | null; respected: boolean | null }>;
  /** rule id → followed (null = not checked yet) + note */
  rules: Record<string, { followed: boolean | null; note: string }>;
  actions: ActionDraft[];
};

export function emptyDebrief(id: string, date: string): DebriefSnapshot {
  return {
    id,
    date,
    gradeContext: null,
    gradeContextNote: "",
    gradeEdge: null,
    gradeEdgeNote: "",
    gradeProcess: null,
    gradeProcessNote: "",
    wentWell: ["", "", ""],
    toImprove: ["", "", ""],
    lesson: "",
    mood: null,
    energy: null,
    completedAt: null,
    scenarios: {},
    levels: {},
    rules: {},
    actions: [],
  };
}

const bullets = (list: string[]) =>
  list
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_BULLETS);

/** Pad to exactly MAX_BULLETS editable slots. */
export function slots(list: string[]): string[] {
  const out = list.slice(0, MAX_BULLETS);
  while (out.length < MAX_BULLETS) out.push("");
  return out;
}

/** What still blocks "Debrief complete". Empty = can complete. */
export function completionIssues(s: DebriefSnapshot, ruleText: Record<string, string>): string[] {
  const issues: string[] = [];
  if (!s.gradeContext) issues.push("Context grade");
  if (!s.gradeEdge) issues.push("Edge grade");
  if (!s.gradeProcess) issues.push("Process grade");
  for (const [ruleId, r] of Object.entries(s.rules)) {
    if (r.followed === false && !r.note.trim()) {
      issues.push(`note for broken rule "${ruleText[ruleId] ?? "rule"}"`);
    }
  }
  return issues;
}

export function toDebriefPayload(s: DebriefSnapshot): Record<string, unknown> {
  return {
    id: s.id,
    date: s.date,
    grade_context: s.gradeContext,
    grade_context_note: s.gradeContextNote.trim(),
    grade_edge: s.gradeEdge,
    grade_edge_note: s.gradeEdgeNote.trim(),
    grade_process: s.gradeProcess,
    grade_process_note: s.gradeProcessNote.trim(),
    went_well: bullets(s.wentWell),
    to_improve: bullets(s.toImprove),
    lesson: s.lesson.trim(),
    mood: s.mood,
    energy: s.energy,
    completed_at: s.completedAt,
    scenarios: Object.entries(s.scenarios).map(([id, v]) => ({
      id,
      outcome: v.outcome,
      traded: v.traded,
    })),
    levels: Object.entries(s.levels).map(([id, v]) => ({
      id,
      tested: v.tested,
      respected: v.respected,
    })),
    rule_checks: Object.entries(s.rules)
      .filter(([, v]) => v.followed !== null)
      .map(([rule_id, v]) => ({ rule_id, followed: v.followed, note: v.note.trim() })),
    action_items: s.actions.map((a) => ({
      id: a.id,
      text: a.text.trim(),
      show_in_prep: a.showInPrep,
      status: a.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// DB → form
// ---------------------------------------------------------------------------

export type DebriefRow = {
  id: string;
  grade_context: string | null;
  grade_context_note: string | null;
  grade_edge: string | null;
  grade_edge_note: string | null;
  grade_process: string | null;
  grade_process_note: string | null;
  went_well: string[];
  to_improve: string[];
  lesson: string | null;
  mood: number | null;
  energy: number | null;
  completed_at: string | null;
};

export function debriefRowToSnapshot(
  row: DebriefRow | null,
  fallbackId: string,
  date: string,
  extras: {
    scenarios: { id: string; outcome: string | null; traded: boolean | null }[];
    levels: { id: string; tested: boolean | null; respected: boolean | null }[];
    rules: { rule_id: string; followed: boolean | null; note: string | null }[];
    actions: { id: string; text: string; show_in_prep: boolean; status: string }[];
  },
): DebriefSnapshot {
  const base = row
    ? {
        ...emptyDebrief(row.id, date),
        gradeContext: row.grade_context as Grade | null,
        gradeContextNote: row.grade_context_note ?? "",
        gradeEdge: row.grade_edge as Grade | null,
        gradeEdgeNote: row.grade_edge_note ?? "",
        gradeProcess: row.grade_process as Grade | null,
        gradeProcessNote: row.grade_process_note ?? "",
        wentWell: slots(row.went_well ?? []),
        toImprove: slots(row.to_improve ?? []),
        lesson: row.lesson ?? "",
        mood: row.mood,
        energy: row.energy,
        completedAt: row.completed_at,
      }
    : emptyDebrief(fallbackId, date);
  return {
    ...base,
    scenarios: Object.fromEntries(
      extras.scenarios.map((x) => [
        x.id,
        { outcome: x.outcome as Outcome | null, traded: x.traded },
      ]),
    ),
    levels: Object.fromEntries(
      extras.levels.map((x) => [x.id, { tested: x.tested, respected: x.respected }]),
    ),
    rules: Object.fromEntries(
      extras.rules.map((x) => [x.rule_id, { followed: x.followed, note: x.note ?? "" }]),
    ),
    actions: extras.actions.map((a) => ({
      id: a.id,
      text: a.text,
      showInPrep: a.show_in_prep,
      status: a.status as ActionDraft["status"],
    })),
  };
}
