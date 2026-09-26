import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { DOMAIN_CODES, type DomainCode } from "@/lib/domains";
import { DISPLAY_TZ } from "@/lib/time";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { formatTreasuryPrice, parseTreasuryPrice } from "./treasury";
import type { PriceFormat } from "./instrument-specs";

/**
 * Trade form model. Inputs are kept as strings (what the user typed) and
 * converted to a DB payload in one place, so the form, autosave and tests all
 * agree on validation.
 */
export const KINDS = ["taken", "missed", "observed"] as const;
export const DIRECTIONS = ["long", "short"] as const;
export const GRADES = ["A", "B", "C", "F"] as const;
export const ENTRY_TYPES = ["limit", "market", "stop"] as const;
export const EXIT_REASONS = [
  "target",
  "stop",
  "trail",
  "discretionary",
  "time",
  "news_flatten",
] as const;

export const EXIT_REASON_LABEL: Record<(typeof EXIT_REASONS)[number], string> = {
  target: "Target",
  stop: "Stop",
  trail: "Trail",
  discretionary: "Discretionary",
  time: "Time",
  news_flatten: "Flat before news",
};

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable();

export const tradeFormSchema = z.object({
  id: z.uuid(),
  kind: z.enum(KINDS),
  instrumentId: z.string(),
  direction: z.enum(DIRECTIONS).nullable(),
  entryAt: z.string(), // "yyyy-MM-ddTHH:mm[:ss]" wall time in the display zone
  exitAt: z.string(),
  entryPrice: z.string(),
  exitPrice: z.string(),
  contracts: z.string(),
  primaryDomain: z.enum(DOMAIN_CODES).nullable(),
  secondaryDomains: z.array(z.enum(DOMAIN_CODES)),
  stopPrice: z.string(),
  targetPrice: z.string(),
  plannedR: z.string(),
  fees: z.string(),
  maeTicks: z.string(),
  mfeTicks: z.string(),
  playbookId: z.string(),
  entryType: optionalEnum(ENTRY_TYPES),
  exitReason: optionalEnum(EXIT_REASONS),
  confidence: z.number().int().min(1).max(5).nullable(),
  gradeContext: optionalEnum(GRADES),
  gradeContextReason: z.string(),
  gradeEdge: optionalEnum(GRADES),
  gradeEdgeReason: z.string(),
  gradeProcess: optionalEnum(GRADES),
  gradeProcessReason: z.string(),
  thesis: z.string(),
  management: z.string(),
  lesson: z.string(),
  moveTrigger: z.string(),
  movePhases: z.string(),
  tagIds: z.array(z.string()),
  calendarEventId: z.string(),
  scenarioId: z.string(),
  keyLevelId: z.string(),
});

export type TradeFormValues = z.infer<typeof tradeFormSchema>;

export type FormInstrument = {
  id: string;
  symbol: string;
  tickSize: number;
  tickValue: number;
  feePerContract: number;
  exchangeTz: string;
  priceFormat: PriceFormat;
  currency: string;
};

/** Current wall time in the display zone, formatted for <input type="datetime-local">. */
export function nowLocalInput(now: Date = new Date(), tz: string = DISPLAY_TZ): string {
  return formatInTimeZone(now, tz, "yyyy-MM-dd'T'HH:mm");
}

export function emptyTradeForm(opts: {
  id: string;
  instrumentId?: string;
  now?: Date;
}): TradeFormValues {
  const now = nowLocalInput(opts.now);
  return {
    id: opts.id,
    kind: "taken",
    instrumentId: opts.instrumentId ?? "",
    direction: null,
    entryAt: now,
    exitAt: now,
    entryPrice: "",
    exitPrice: "",
    contracts: "1",
    primaryDomain: null,
    secondaryDomains: [],
    stopPrice: "",
    targetPrice: "",
    plannedR: "",
    fees: "",
    maeTicks: "",
    mfeTicks: "",
    playbookId: "",
    entryType: null,
    exitReason: null,
    confidence: null,
    gradeContext: null,
    gradeContextReason: "",
    gradeEdge: null,
    gradeEdgeReason: "",
    gradeProcess: null,
    gradeProcessReason: "",
    thesis: "",
    management: "",
    lesson: "",
    moveTrigger: "",
    movePhases: "",
    tagIds: [],
    calendarEventId: "",
    scenarioId: "",
    keyLevelId: "",
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Accepts "1.25" and "1,25" (Portuguese keyboards). Empty → null. */
export function parseDecimal(raw: string): number | null | "invalid" {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return "invalid";
  const n = Number(s);
  return Number.isFinite(n) ? n : "invalid";
}

function onTick(value: number, tick: number) {
  const q = value / tick;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

export function parsePrice(
  raw: string,
  inst: Pick<FormInstrument, "tickSize" | "priceFormat">,
): { value: number | null; error?: string } {
  if (!raw.trim()) return { value: null };
  if (inst.priceFormat === "thirty_seconds") {
    const r = parseTreasuryPrice(raw.replace(",", "."), inst.tickSize);
    return r.ok ? { value: r.value } : { value: null, error: r.error };
  }
  const n = parseDecimal(raw);
  if (n === "invalid") return { value: null, error: "Not a number" };
  if (n === null) return { value: null };
  if (n <= 0) return { value: null, error: "Must be above 0" };
  if (!onTick(n, inst.tickSize)) return { value: null, error: `Not on a ${inst.tickSize} tick` };
  return { value: n };
}

/** Decimal places needed to show every tick exactly (0.25 → 2, 0.00005 → 5, 5 → 0). */
export function tickDecimals(tick: number): number {
  for (let i = 0; i <= 10; i++) {
    const scaled = tick * 10 ** i;
    if (Math.abs(Math.round(scaled) - scaled) < 1e-9) return i;
  }
  return 10;
}

export function formatPrice(
  value: number | null | undefined,
  inst: Pick<FormInstrument, "tickSize" | "priceFormat">,
): string {
  if (value === null || value === undefined) return "";
  if (inst.priceFormat === "thirty_seconds") return formatTreasuryPrice(value, inst.tickSize);
  return value.toFixed(tickDecimals(inst.tickSize));
}

export function localInputToIso(local: string, tz: string = DISPLAY_TZ): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return null;
  const d = fromZonedTime(local.replace("T", " "), tz);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoToLocalInput(iso: string | null | undefined, tz: string = DISPLAY_TZ): string {
  if (!iso) return "";
  return formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm:ss").replace(/:00$/, "");
}

// ---------------------------------------------------------------------------
// Form → DB payload
// ---------------------------------------------------------------------------

export type TradeRowPayload = TablesInsert<"trades"> & { id: string };

export type ToPayloadResult = {
  /** Field-level problems (bad number, off-tick, exit before entry…). */
  errors: Partial<Record<keyof TradeFormValues, string>>;
  /** Spec-required fields still empty (quick form). */
  missing: (keyof TradeFormValues)[];
  /** Payload when the DB can accept the row (may still be incomplete). */
  payload: TradeRowPayload | null;
};

const REQUIRED_FOR_DB: (keyof TradeFormValues)[] = [
  "instrumentId",
  "direction",
  "entryAt",
  "entryPrice",
];

function num(raw: string, field: keyof TradeFormValues, errors: ToPayloadResult["errors"]) {
  const n = parseDecimal(raw);
  if (n === "invalid") {
    errors[field] = "Not a number";
    return null;
  }
  return n;
}

export function toTradePayload(
  v: TradeFormValues,
  inst: FormInstrument | undefined,
): ToPayloadResult {
  const errors: ToPayloadResult["errors"] = {};
  const isObserved = v.kind === "observed";

  const required: (keyof TradeFormValues)[] = [
    "instrumentId",
    "direction",
    "entryAt",
    "entryPrice",
    "exitAt",
    "exitPrice",
    "primaryDomain",
    ...(isObserved ? [] : (["contracts"] as const)),
  ];
  const missing = required.filter((k) => {
    const val = v[k];
    return val === null || val === "" || (Array.isArray(val) && val.length === 0);
  });

  if (!inst) return { errors, missing, payload: null };

  const price = (field: keyof TradeFormValues, raw: string) => {
    const r = parsePrice(raw, inst);
    if (r.error) errors[field] = r.error;
    return r.value;
  };

  const entryPrice = price("entryPrice", v.entryPrice);
  const exitPrice = price("exitPrice", v.exitPrice);
  const stopPrice = price("stopPrice", v.stopPrice);
  const targetPrice = price("targetPrice", v.targetPrice);

  const entryAt = v.entryAt ? localInputToIso(v.entryAt) : null;
  if (v.entryAt && !entryAt) errors.entryAt = "Invalid time";
  const exitAt = v.exitAt ? localInputToIso(v.exitAt) : null;
  if (v.exitAt && !exitAt) errors.exitAt = "Invalid time";
  if (entryAt && exitAt && exitAt < entryAt) errors.exitAt = "Exit is before entry";

  let contracts: number | null = null;
  if (!isObserved) {
    contracts = num(v.contracts, "contracts", errors);
    if (contracts !== null && contracts <= 0) {
      errors.contracts = "Must be above 0";
      contracts = null;
    }
  }

  const fees = num(v.fees, "fees", errors);
  if (fees !== null && fees < 0) errors.fees = "Cannot be negative";

  if (
    stopPrice !== null &&
    entryPrice !== null &&
    v.direction &&
    (v.direction === "long" ? stopPrice >= entryPrice : stopPrice <= entryPrice)
  ) {
    errors.stopPrice =
      v.direction === "long" ? "Stop must be below entry" : "Stop must be above entry";
  }

  const dbReady =
    REQUIRED_FOR_DB.every((k) => v[k] !== null && v[k] !== "") &&
    entryPrice !== null &&
    entryAt !== null &&
    (isObserved || contracts !== null) &&
    !errors.entryPrice &&
    !errors.entryAt &&
    !errors.exitAt &&
    !errors.contracts &&
    !errors.stopPrice;

  if (!dbReady) return { errors, missing, payload: null };

  const text = (s: string) => (s.trim() ? s.trim() : null);

  const payload: TradeRowPayload = {
    id: v.id,
    kind: v.kind,
    instrument_id: inst.id,
    direction: v.direction!,
    entry_at: entryAt!,
    exit_at: errors.exitAt ? null : exitAt,
    entry_price: entryPrice!,
    exit_price: errors.exitPrice ? null : exitPrice,
    stop_price: errors.stopPrice ? null : stopPrice,
    target_price: errors.targetPrice ? null : targetPrice,
    planned_r: num(v.plannedR, "plannedR", errors),
    contracts: isObserved ? null : contracts,
    fees: errors.fees ? null : fees,
    mae_ticks: num(v.maeTicks, "maeTicks", errors),
    mfe_ticks: num(v.mfeTicks, "mfeTicks", errors),
    primary_domain: v.primaryDomain,
    secondary_domains: v.secondaryDomains.filter((d) => d !== v.primaryDomain),
    playbook_id: v.playbookId || null,
    entry_type: v.entryType,
    exit_reason: v.exitReason,
    confidence: v.confidence,
    grade_context: v.gradeContext,
    grade_context_reason: text(v.gradeContextReason),
    grade_edge: v.gradeEdge,
    grade_edge_reason: text(v.gradeEdgeReason),
    grade_process: v.gradeProcess,
    grade_process_reason: text(v.gradeProcessReason),
    thesis: text(v.thesis),
    management: text(v.management),
    lesson: text(v.lesson),
    move_trigger: isObserved ? text(v.moveTrigger) : null,
    move_phases: isObserved ? text(v.movePhases) : null,
    calendar_event_id: v.calendarEventId || null,
    scenario_id: v.scenarioId || null,
    key_level_id: v.keyLevelId || null,
  };

  return { errors, missing, payload };
}

/** DB row → form values (for editing an existing trade). */
export function tradeRowToForm(
  row: {
    id: string;
    kind: string;
    instrument_id: string;
    direction: string;
    entry_at: string;
    exit_at: string | null;
    entry_price: number;
    exit_price: number | null;
    contracts: number | null;
    primary_domain: string | null;
    secondary_domains: string[];
    stop_price: number | null;
    target_price: number | null;
    planned_r: number | null;
    fees: number | null;
    mae_ticks: number | null;
    mfe_ticks: number | null;
    playbook_id: string | null;
    entry_type: string | null;
    exit_reason: string | null;
    confidence: number | null;
    grade_context: string | null;
    grade_context_reason: string | null;
    grade_edge: string | null;
    grade_edge_reason: string | null;
    grade_process: string | null;
    grade_process_reason: string | null;
    thesis: string | null;
    management: string | null;
    lesson: string | null;
    move_trigger: string | null;
    move_phases: string | null;
    calendar_event_id?: string | null;
    scenario_id?: string | null;
    key_level_id?: string | null;
  },
  inst: Pick<FormInstrument, "tickSize" | "priceFormat">,
  tagIds: string[],
): TradeFormValues {
  const s = (n: number | null) => (n === null || n === undefined ? "" : String(n));
  const p = (n: number | null) => formatPrice(n === null ? null : Number(n), inst);
  return {
    id: row.id,
    kind: row.kind as TradeFormValues["kind"],
    instrumentId: row.instrument_id,
    direction: row.direction as TradeFormValues["direction"],
    entryAt: isoToLocalInput(row.entry_at),
    exitAt: isoToLocalInput(row.exit_at),
    entryPrice: p(row.entry_price),
    exitPrice: p(row.exit_price),
    contracts: s(row.contracts),
    primaryDomain: row.primary_domain as DomainCode | null,
    secondaryDomains: row.secondary_domains as DomainCode[],
    stopPrice: p(row.stop_price),
    targetPrice: p(row.target_price),
    plannedR: s(row.planned_r),
    fees: s(row.fees),
    maeTicks: s(row.mae_ticks),
    mfeTicks: s(row.mfe_ticks),
    playbookId: row.playbook_id ?? "",
    entryType: row.entry_type as TradeFormValues["entryType"],
    exitReason: row.exit_reason as TradeFormValues["exitReason"],
    confidence: row.confidence,
    gradeContext: row.grade_context as TradeFormValues["gradeContext"],
    gradeContextReason: row.grade_context_reason ?? "",
    gradeEdge: row.grade_edge as TradeFormValues["gradeEdge"],
    gradeEdgeReason: row.grade_edge_reason ?? "",
    gradeProcess: row.grade_process as TradeFormValues["gradeProcess"],
    gradeProcessReason: row.grade_process_reason ?? "",
    thesis: row.thesis ?? "",
    management: row.management ?? "",
    lesson: row.lesson ?? "",
    moveTrigger: row.move_trigger ?? "",
    movePhases: row.move_phases ?? "",
    tagIds,
    calendarEventId: row.calendar_event_id ?? "",
    scenarioId: row.scenario_id ?? "",
    keyLevelId: row.key_level_id ?? "",
  };
}
