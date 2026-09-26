import type { DomainCode } from "@/lib/domains";
import { parseDecimal, type FormInstrument } from "@/lib/trading/trade-form";
import { formatTreasuryPrice, parseTreasuryPrice } from "@/lib/trading/treasury";

/**
 * Session prep form model. The whole prep (fields + key levels + scenarios +
 * rule acknowledgements) is one snapshot, autosaved through the
 * `save_prep` RPC in a single transaction.
 */

export type SessionCode = "EU" | "US";

export const PRIOR_DAY_TYPES = [
  "Trend",
  "Double distribution",
  "Normal",
  "Normal variation",
  "Neutral",
  "Non-trend",
  "P-shape",
  "b-shape",
];
export const REGIMES = [
  "Trending",
  "Balancing / rotational",
  "Breakout pending",
  "Event-driven",
  "Illiquid / holiday",
];
export const LEVEL_TYPES = [
  "PDH",
  "PDL",
  "PDC",
  "ONH",
  "ONL",
  "VAH",
  "VAL",
  "POC",
  "Naked POC",
  "Single prints",
  "Poor high",
  "Poor low",
  "Beginning zone",
  "Weekly high",
  "Weekly low",
  "Monthly high",
  "Monthly low",
];

export type LevelDraft = {
  id: string;
  instrumentId: string;
  priceLow: string;
  priceHigh: string;
  levelType: string;
  strength: 1 | 2 | 3;
  note: string;
  carriedFromId: string | null;
};

export type ScenarioDraft = {
  id: string;
  instrumentId: string;
  direction: "" | "long" | "short";
  ifText: string;
  thenText: string;
  playbookId: string;
  domain: DomainCode | "";
};

export type PrepSnapshot = {
  id: string;
  date: string;
  session: SessionCode;
  sleep: number | null;
  energy: number | null;
  focus: number | null;
  howAmI: string;
  briefMd: string;
  priorDayType: string;
  regime: string;
  volState: "" | "low" | "normal" | "high";
  narrative: string;
  optionsNotes: string;
  focusInstrumentIds: string[];
  focusPlaybookIds: string[];
  intention: string;
  maxLossUsd: string;
  maxLossR: string;
  maxTrades: string;
  maxSize: string;
  completedAt: string | null;
  copiedFromId: string | null;
  levels: LevelDraft[];
  scenarios: ScenarioDraft[];
  /** rule id → acknowledged */
  ruleChecks: Record<string, boolean>;
};

export type PrepInstrument = Pick<FormInstrument, "id" | "symbol" | "tickSize" | "priceFormat">;

export function emptyPrep(id: string, date: string, session: SessionCode): PrepSnapshot {
  return {
    id,
    date,
    session,
    sleep: null,
    energy: null,
    focus: null,
    howAmI: "",
    briefMd: "",
    priorDayType: "",
    regime: "",
    volState: "",
    narrative: "",
    optionsNotes: "",
    focusInstrumentIds: [],
    focusPlaybookIds: [],
    intention: "",
    maxLossUsd: "",
    maxLossR: "",
    maxTrades: "",
    maxSize: "",
    completedAt: null,
    copiedFromId: null,
    levels: [],
    scenarios: [],
    ruleChecks: {},
  };
}

export function isReady(p: Pick<PrepSnapshot, "sleep" | "energy" | "focus">) {
  return p.sleep !== null && p.energy !== null && p.focus !== null;
}

/** Level prices: any positive number (levels need not sit on a tick); 32nds for Treasuries. */
export function parseLevelPrice(
  raw: string,
  inst: PrepInstrument | undefined,
): { value: number | null; error?: string } {
  if (!raw.trim()) return { value: null };
  if (inst?.priceFormat === "thirty_seconds") {
    const r = parseTreasuryPrice(raw.replace(",", "."));
    return r.ok ? { value: r.value } : { value: null, error: r.error };
  }
  const n = parseDecimal(raw);
  if (n === "invalid") return { value: null, error: "Not a number" };
  if (n === null) return { value: null };
  if (n <= 0) return { value: null, error: "Must be above 0" };
  return { value: n };
}

export function formatLevelPrice(value: number | null, inst: PrepInstrument | undefined): string {
  if (value === null) return "";
  if (inst?.priceFormat === "thirty_seconds") return formatTreasuryPrice(value, inst.tickSize);
  return String(value);
}

export type LevelIssue = { id: string; message: string };

function num(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === "invalid" ? null : n;
}

function int(raw: string): number | null {
  const n = num(raw);
  return n === null ? null : Math.round(n);
}

/**
 * Snapshot → `save_prep` payload. Level rows that are incomplete or invalid
 * are left out (kept on the device) and reported; a zone's high must be above
 * its low.
 */
export function toPrepPayload(
  p: PrepSnapshot,
  instruments: PrepInstrument[],
): { payload: Record<string, unknown>; issues: LevelIssue[] } {
  const byId = new Map(instruments.map((i) => [i.id, i]));
  const issues: LevelIssue[] = [];
  const levels: Record<string, unknown>[] = [];
  for (const l of p.levels) {
    const inst = byId.get(l.instrumentId);
    const low = parseLevelPrice(l.priceLow, inst);
    const high = parseLevelPrice(l.priceHigh, inst);
    if (!inst || low.value === null || !l.levelType.trim()) {
      if (low.error) issues.push({ id: l.id, message: low.error });
      continue;
    }
    if (high.error) {
      issues.push({ id: l.id, message: `Zone high: ${high.error}` });
      continue;
    }
    let lo = low.value;
    let hi = high.value;
    if (hi !== null && hi < lo) [lo, hi] = [hi, lo];
    levels.push({
      id: l.id,
      instrument_id: l.instrumentId,
      price_low: lo,
      price_high: hi === lo ? null : hi,
      level_type: l.levelType.trim(),
      strength: l.strength,
      note: l.note.trim() || null,
      carried_from_id: l.carriedFromId,
    });
  }

  const scenarios = p.scenarios
    .filter((s) => s.ifText.trim() || s.thenText.trim())
    .map((s) => ({
      id: s.id,
      instrument_id: s.instrumentId || null,
      direction: s.direction || null,
      if_text: s.ifText.trim(),
      then_text: s.thenText.trim(),
      playbook_id: s.playbookId || null,
      primary_domain: s.domain || null,
    }));

  const nonNeg = (raw: string) => {
    const n = num(raw);
    return n !== null && n >= 0 ? n : null;
  };

  return {
    payload: {
      id: p.id,
      date: p.date,
      session: p.session,
      sleep: p.sleep,
      energy: p.energy,
      focus: p.focus,
      how_am_i: p.howAmI.trim(),
      brief_md: p.briefMd,
      prior_day_type: p.priorDayType.trim(),
      regime: p.regime.trim(),
      vol_state: p.volState,
      narrative: p.narrative.trim(),
      options_notes: p.optionsNotes.trim(),
      focus_instrument_ids: p.focusInstrumentIds,
      focus_playbook_ids: p.focusPlaybookIds,
      intention: p.intention.trim(),
      max_loss_usd: nonNeg(p.maxLossUsd),
      max_loss_r: nonNeg(p.maxLossR),
      max_trades: (() => {
        const n = int(p.maxTrades);
        return n !== null && n >= 0 ? n : null;
      })(),
      max_size: nonNeg(p.maxSize),
      completed_at: p.completedAt,
      copied_from_id: p.copiedFromId,
      levels,
      scenarios,
      rule_checks: Object.entries(p.ruleChecks).map(([rule_id, followed]) => ({
        rule_id,
        followed,
      })),
    },
    issues,
  };
}

/** Strongest first (3 → 1), then higher price first; stable otherwise. */
export function sortLevels<T extends { strength: number; priceLow: string | number }>(
  levels: T[],
): T[] {
  return [...levels]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      if (b.l.strength !== a.l.strength) return b.l.strength - a.l.strength;
      const pa = Number(a.l.priceLow);
      const pb = Number(b.l.priceLow);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pb - pa;
      return a.i - b.i;
    })
    .map((x) => x.l);
}

type NewId = () => string;

/**
 * Levels to carry forward: untested (tested ≠ true) levels from the previous
 * prep that are not already carried into this one.
 */
export function carryForward(
  current: LevelDraft[],
  previous: LevelDraft[],
  previousTested: Record<string, boolean | null>,
  newId: NewId,
): LevelDraft[] {
  const already = new Set(current.map((l) => l.carriedFromId).filter(Boolean));
  return previous
    .filter((l) => previousTested[l.id] !== true && !already.has(l.id))
    .map((l) => ({ ...l, id: newId(), carriedFromId: l.id }));
}

/**
 * US prep "copy forward" from the EU prep: context, focus, risk plan, levels
 * and scenarios. Readiness and the brief are session-specific and stay.
 */
export function copyFromPrep(us: PrepSnapshot, eu: PrepSnapshot, newId: NewId): PrepSnapshot {
  const carried = new Set(us.levels.map((l) => l.carriedFromId).filter(Boolean));
  return {
    ...us,
    priorDayType: eu.priorDayType,
    regime: eu.regime,
    volState: eu.volState,
    narrative: eu.narrative,
    optionsNotes: eu.optionsNotes,
    focusInstrumentIds: eu.focusInstrumentIds,
    focusPlaybookIds: eu.focusPlaybookIds,
    intention: eu.intention,
    maxLossUsd: eu.maxLossUsd,
    maxLossR: eu.maxLossR,
    maxTrades: eu.maxTrades,
    maxSize: eu.maxSize,
    copiedFromId: eu.id,
    levels: [
      ...us.levels,
      ...eu.levels
        .filter((l) => !carried.has(l.id))
        .map((l) => ({ ...l, id: newId(), carriedFromId: l.id })),
    ],
    scenarios: [...us.scenarios, ...eu.scenarios.map((s) => ({ ...s, id: newId() }))],
  };
}

/** True when the snapshot holds anything beyond ids (used before overwriting). */
export function hasContent(p: PrepSnapshot) {
  return (
    p.levels.length > 0 ||
    p.scenarios.length > 0 ||
    !!(p.narrative || p.regime || p.priorDayType || p.intention || p.maxLossUsd)
  );
}

// ---------------------------------------------------------------------------
// DB → form
// ---------------------------------------------------------------------------

export type PrepRow = {
  id: string;
  sleep: number | null;
  energy: number | null;
  focus: number | null;
  how_am_i: string | null;
  brief_md: string | null;
  prior_day_type: string | null;
  regime: string | null;
  vol_state: string | null;
  narrative: string | null;
  options_notes: string | null;
  focus_instrument_ids: string[];
  focus_playbook_ids: string[];
  intention: string | null;
  max_loss_usd: number | null;
  max_loss_r: number | null;
  max_trades: number | null;
  max_size: number | null;
  completed_at: string | null;
  copied_from_id: string | null;
};

export type LevelRow = {
  id: string;
  instrument_id: string;
  price_low: number;
  price_high: number | null;
  level_type: string;
  strength: number;
  note: string | null;
  carried_from_id: string | null;
  tested: boolean | null;
};

export type ScenarioRow = {
  id: string;
  instrument_id: string | null;
  direction: string | null;
  if_text: string;
  then_text: string;
  playbook_id: string | null;
  primary_domain: string | null;
};

const s = (v: string | null | undefined) => v ?? "";
const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function levelRowToDraft(r: LevelRow, instruments: PrepInstrument[]): LevelDraft {
  const inst = instruments.find((i) => i.id === r.instrument_id);
  return {
    id: r.id,
    instrumentId: r.instrument_id,
    priceLow: formatLevelPrice(Number(r.price_low), inst),
    priceHigh: r.price_high === null ? "" : formatLevelPrice(Number(r.price_high), inst),
    levelType: r.level_type,
    strength: Math.min(3, Math.max(1, r.strength)) as 1 | 2 | 3,
    note: s(r.note),
    carriedFromId: r.carried_from_id,
  };
}

export function scenarioRowToDraft(r: ScenarioRow): ScenarioDraft {
  return {
    id: r.id,
    instrumentId: s(r.instrument_id),
    direction: (r.direction ?? "") as ScenarioDraft["direction"],
    ifText: r.if_text,
    thenText: r.then_text,
    playbookId: s(r.playbook_id),
    domain: (r.primary_domain ?? "") as ScenarioDraft["domain"],
  };
}

export function prepRowToSnapshot(
  row: PrepRow,
  date: string,
  session: SessionCode,
  levels: LevelRow[],
  scenarios: ScenarioRow[],
  ruleChecks: { rule_id: string; followed: boolean | null }[],
  instruments: PrepInstrument[],
): PrepSnapshot {
  return {
    id: row.id,
    date,
    session,
    sleep: row.sleep,
    energy: row.energy,
    focus: row.focus,
    howAmI: s(row.how_am_i),
    briefMd: s(row.brief_md),
    priorDayType: s(row.prior_day_type),
    regime: s(row.regime),
    volState: (row.vol_state ?? "") as PrepSnapshot["volState"],
    narrative: s(row.narrative),
    optionsNotes: s(row.options_notes),
    focusInstrumentIds: row.focus_instrument_ids ?? [],
    focusPlaybookIds: row.focus_playbook_ids ?? [],
    intention: s(row.intention),
    maxLossUsd: n(row.max_loss_usd),
    maxLossR: n(row.max_loss_r),
    maxTrades: n(row.max_trades),
    maxSize: n(row.max_size),
    completedAt: row.completed_at,
    copiedFromId: row.copied_from_id,
    levels: levels.map((l) => levelRowToDraft(l, instruments)),
    scenarios: scenarios.map(scenarioRowToDraft),
    ruleChecks: Object.fromEntries(ruleChecks.map((c) => [c.rule_id, c.followed === true])),
  };
}
