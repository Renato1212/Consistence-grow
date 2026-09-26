/**
 * Every attribute a trade can be sliced by. One definition feeds the filter
 * bar, Breakdowns and the Pattern Finder, so labels and buckets always agree.
 */
import { domainLabel } from "@/lib/domains";
import { eventBucket } from "@/lib/playbook/stats";
import type { InsightTrade } from "./types";

export type DimensionKey =
  | "instrument"
  | "direction"
  | "domain"
  | "secondary"
  | "domainCount"
  | "playbook"
  | "session"
  | "weekday"
  | "timeBucket"
  | "event"
  | "eventType"
  | "regime"
  | "priorDay"
  | "tag"
  | "gradeContext"
  | "gradeEdge"
  | "gradeProcess"
  | "confidence"
  | "prep"
  | "readiness"
  | "levelStrength"
  | "exitReason"
  | "month";

export type Dimension = {
  key: DimensionKey;
  label: string;
  /** Values of a trade; empty = not set. Multi-valued for tags / secondary domains. */
  values: (t: InsightTrade) => string[];
  /** Human label of a value. */
  display?: (v: string) => string;
  /** Fixed value order (else by n). */
  order?: string[];
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const EVENT_BUCKETS = [
  "< −30 min",
  "−30…0 min",
  "0–5 min",
  "5–15 min",
  "15–60 min",
  "> 60 min",
  "No event",
];
export const READINESS_BANDS = ["< 2.5", "2.5–3.5", "≥ 3.5"];
export const GRADES = ["A", "B", "C", "F"];

export function readinessBand(r: number | null): string | null {
  if (r === null) return null;
  if (r < 2.5) return "< 2.5";
  if (r < 3.5) return "2.5–3.5";
  return "≥ 3.5";
}

const one = (v: string | number | null | undefined): string[] =>
  v === null || v === undefined || v === "" ? [] : [String(v)];

const STRENGTH: Record<string, string> = { "1": "Weak", "2": "Medium", "3": "Strong" };

export const DIMENSIONS: Dimension[] = [
  { key: "instrument", label: "Instrument", values: (t) => one(t.symbol) },
  {
    key: "direction",
    label: "Direction",
    values: (t) => one(t.direction),
    display: (v) => (v === "long" ? "Long" : "Short"),
    order: ["long", "short"],
  },
  {
    key: "domain",
    label: "Primary domain",
    values: (t) => one(t.primary_domain),
    display: domainLabel,
  },
  {
    key: "secondary",
    label: "Secondary domain",
    values: (t) => t.secondary_domains ?? [],
    display: domainLabel,
  },
  {
    key: "domainCount",
    label: "Domain confluence",
    values: (t) => (t.domain_count ? [t.domain_count >= 3 ? "3+" : String(t.domain_count)] : []),
    display: (v) => (v === "1" ? "Single domain" : `${v} domains`),
    order: ["1", "2", "3+"],
  },
  {
    key: "playbook",
    label: "Playbook",
    values: (t) => one(t.playbook_name),
  },
  { key: "session", label: "Session", values: (t) => one(t.session), order: ["ASIA", "EU", "US"] },
  {
    key: "weekday",
    label: "Weekday",
    values: (t) => one(t.weekday),
    display: (v) => WEEKDAYS[Number(v) - 1] ?? v,
    order: ["1", "2", "3", "4", "5", "6", "7"],
  },
  {
    key: "timeBucket",
    label: "Time of day (exchange)",
    values: (t) => one(t.time_bucket),
  },
  {
    key: "event",
    label: "Minutes from event",
    values: (t) => [eventBucket(t.minutes_from_event)],
    order: EVENT_BUCKETS,
  },
  { key: "eventType", label: "Event type", values: (t) => one(t.event_category) },
  { key: "regime", label: "Market regime", values: (t) => one(t.regime) },
  { key: "priorDay", label: "Prior day type", values: (t) => one(t.prior_day_type) },
  { key: "tag", label: "Tag", values: (t) => t.tag_names ?? [] },
  {
    key: "gradeContext",
    label: "Context grade",
    values: (t) => one(t.grade_context),
    order: GRADES,
  },
  { key: "gradeEdge", label: "Edge grade", values: (t) => one(t.grade_edge), order: GRADES },
  {
    key: "gradeProcess",
    label: "Process grade",
    values: (t) => one(t.grade_process),
    order: GRADES,
  },
  {
    key: "confidence",
    label: "Confidence",
    values: (t) => one(t.confidence),
    order: ["1", "2", "3", "4", "5"],
  },
  {
    key: "prep",
    label: "Prep done",
    values: (t) => (t.prep_done === null ? [] : [t.prep_done ? "yes" : "no"]),
    display: (v) => (v === "yes" ? "Prep complete" : "No complete prep"),
    order: ["yes", "no"],
  },
  {
    key: "readiness",
    label: "Readiness",
    values: (t) => one(readinessBand(t.readiness)),
    order: READINESS_BANDS,
  },
  {
    key: "levelStrength",
    label: "Level strength",
    values: (t) => one(t.level_strength),
    display: (v) => STRENGTH[v] ?? v,
    order: ["1", "2", "3"],
  },
  { key: "exitReason", label: "Exit reason", values: (t) => one(t.exit_reason) },
  { key: "month", label: "Month", values: (t) => one(t.trade_date?.slice(0, 7)) },
];

export const DIMENSION_BY_KEY = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d])) as Record<
  DimensionKey,
  Dimension
>;

/** Attributes the Pattern Finder combines (spec 6.9). */
export const PATTERN_DIMENSIONS: DimensionKey[] = [
  "domain",
  "secondary",
  "playbook",
  "tag",
  "timeBucket",
  "weekday",
  "event",
  "regime",
  "priorDay",
  "instrument",
  "levelStrength",
  "confidence",
  "readiness",
];

export function displayValue(key: DimensionKey, v: string): string {
  if (v === "—") return "Not set";
  return DIMENSION_BY_KEY[key].display?.(v) ?? v;
}
