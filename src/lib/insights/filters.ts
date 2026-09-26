/**
 * The global Insights filter: one plain object, encoded in the URL (shareable,
 * survives reload, persists across tabs) and stored as-is in saved views.
 */
import { z } from "zod";

import { addDays } from "@/lib/calendar/dates";
import { DIMENSION_BY_KEY, displayValue, type DimensionKey } from "./dimensions";
import type { InsightTrade } from "./types";

export const RANGES = ["30d", "90d", "ytd", "all", "custom"] as const;
export type Range = (typeof RANGES)[number];
export const KINDS = ["taken", "missed", "observed"] as const;
export type Kind = (typeof KINDS)[number];
export type TagMode = "any" | "all" | "none";

/** Dimension filters and their URL parameter names. */
export const FILTER_PARAMS = {
  instrument: "inst",
  direction: "dir",
  domain: "dom",
  secondary: "sdom",
  domainCount: "dc",
  playbook: "pb",
  session: "ses",
  weekday: "wd",
  timeBucket: "tb",
  event: "ev",
  eventType: "evt",
  regime: "reg",
  priorDay: "pdt",
  tag: "tag",
  gradeContext: "gc",
  gradeEdge: "ge",
  gradeProcess: "gp",
  confidence: "conf",
  prep: "prep",
  levelStrength: "lvl",
  exitReason: "exit",
} as const satisfies Partial<Record<DimensionKey, string>>;
export type FilterKey = keyof typeof FILTER_PARAMS;
export const FILTER_KEYS = Object.keys(FILTER_PARAMS) as FilterKey[];

export type Filter = {
  range: Range;
  from: string | null;
  to: string | null;
  kinds: Kind[];
  values: Partial<Record<FilterKey, string[]>>;
  tagMode: TagMode;
  playbookVersion: number | null;
  readinessMin: number | null;
  readinessMax: number | null;
};

export const DEFAULT_FILTER: Filter = {
  range: "all",
  from: null,
  to: null,
  kinds: ["taken"],
  values: {},
  tagMode: "any",
  playbookVersion: null,
  readinessMin: null,
  readinessMax: null,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = z.number().finite();

/** Schema for filters coming back from the database (saved views). */
export const filterSchema = z.object({
  range: z.enum(RANGES).catch("all"),
  from: isoDate.nullable().catch(null),
  to: isoDate.nullable().catch(null),
  kinds: z.array(z.enum(KINDS)).min(1).catch(["taken"]),
  values: z
    .record(z.string(), z.array(z.string().max(200)).max(50))
    .transform((v) =>
      Object.fromEntries(
        Object.entries(v).filter(([k, list]) => k in FILTER_PARAMS && list.length > 0),
      ),
    )
    .catch({}),
  tagMode: z.enum(["any", "all", "none"]).catch("any"),
  playbookVersion: z.number().int().positive().nullable().catch(null),
  readinessMin: num.nullable().catch(null),
  readinessMax: num.nullable().catch(null),
}) as unknown as z.ZodType<Filter>;

export function normalizeFilter(raw: unknown): Filter {
  const r = filterSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_FILTER;
}

type Params = { get(k: string): string | null; getAll(k: string): string[] };

const numOrNull = (s: string | null): number | null => {
  if (s === null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function parseFilter(p: Params): Filter {
  const range = (RANGES as readonly string[]).includes(p.get("range") ?? "")
    ? (p.get("range") as Range)
    : "all";
  const date = (k: string) => {
    const v = p.get(k);
    return v && isoDate.safeParse(v).success ? v : null;
  };
  const kinds = p.getAll("kind").filter((k): k is Kind => (KINDS as readonly string[]).includes(k));
  const values: Filter["values"] = {};
  for (const key of FILTER_KEYS) {
    const list = [...new Set(p.getAll(FILTER_PARAMS[key]).filter(Boolean))].slice(0, 50);
    if (list.length) values[key] = list;
  }
  const tm = p.get("tagm");
  const pbv = numOrNull(p.get("pbv"));
  return {
    range,
    from: range === "custom" ? date("from") : null,
    to: range === "custom" ? date("to") : null,
    kinds: kinds.length ? [...new Set(kinds)] : ["taken"],
    values,
    tagMode: tm === "all" || tm === "none" ? tm : "any",
    playbookVersion:
      pbv !== null && Number.isInteger(pbv) && pbv > 0 && values.playbook?.length === 1
        ? pbv
        : null,
    readinessMin: numOrNull(p.get("rmin")),
    readinessMax: numOrNull(p.get("rmax")),
  };
}

/** Query string for a filter (defaults omitted, stable order). */
export function filterToQuery(f: Filter): URLSearchParams {
  const q = new URLSearchParams();
  if (f.range !== "all") q.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
  }
  if (!(f.kinds.length === 1 && f.kinds[0] === "taken"))
    for (const k of f.kinds) q.append("kind", k);
  for (const key of FILTER_KEYS)
    for (const v of f.values[key] ?? []) q.append(FILTER_PARAMS[key], v);
  if (f.tagMode !== "any" && f.values.tag?.length) q.set("tagm", f.tagMode);
  if (f.playbookVersion !== null && f.values.playbook?.length === 1)
    q.set("pbv", String(f.playbookVersion));
  if (f.readinessMin !== null) q.set("rmin", String(f.readinessMin));
  if (f.readinessMax !== null) q.set("rmax", String(f.readinessMax));
  return q;
}

/** Inclusive Lisbon date bounds of the range (null = open). */
export function dateBounds(f: Filter, today: string): { from: string | null; to: string | null } {
  switch (f.range) {
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return { from: f.from, to: f.to };
    default:
      return { from: null, to: null };
  }
}

/** Filter with every constraint except the kinds (Missed & observed uses its own). */
export function matchesExceptKind(t: InsightTrade, f: Filter, today: string): boolean {
  const { from, to } = dateBounds(f, today);
  if (from || to) {
    if (!t.trade_date) return false;
    if (from && t.trade_date < from) return false;
    if (to && t.trade_date > to) return false;
  }
  for (const key of FILTER_KEYS) {
    const wanted = f.values[key];
    if (!wanted?.length) continue;
    const have = DIMENSION_BY_KEY[key].values(t);
    if (key === "tag") {
      if (f.tagMode === "all" && !wanted.every((w) => have.includes(w))) return false;
      if (f.tagMode === "none" && wanted.some((w) => have.includes(w))) return false;
      if (f.tagMode === "any" && !wanted.some((w) => have.includes(w))) return false;
      continue;
    }
    if (!wanted.some((w) => have.includes(w))) return false;
  }
  if (f.playbookVersion !== null && t.playbook_version !== f.playbookVersion) return false;
  if (f.readinessMin !== null && (t.readiness === null || t.readiness < f.readinessMin))
    return false;
  if (f.readinessMax !== null && (t.readiness === null || t.readiness > f.readinessMax))
    return false;
  return true;
}

export function applyFilter(trades: InsightTrade[], f: Filter, today: string): InsightTrade[] {
  return trades.filter((t) => f.kinds.includes(t.kind) && matchesExceptKind(t, f, today));
}

export type Chip = { id: string; label: string; without: Filter };

const RANGE_LABEL: Record<Range, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
  all: "All time",
  custom: "Custom",
};
export { RANGE_LABEL };

/** Active constraints as removable chips (date range and kinds excluded). */
export function filterChips(f: Filter): Chip[] {
  const chips: Chip[] = [];
  for (const key of FILTER_KEYS) {
    for (const v of f.values[key] ?? []) {
      const rest = (f.values[key] ?? []).filter((x) => x !== v);
      const values = { ...f.values, [key]: rest };
      if (!rest.length) delete values[key];
      const tagPrefix = key === "tag" && f.tagMode !== "any" ? `${f.tagMode} ` : "";
      chips.push({
        id: `${key}:${v}`,
        label: `${DIMENSION_BY_KEY[key].label}: ${tagPrefix}${displayValue(key, v)}`,
        without: {
          ...f,
          values,
          playbookVersion: key === "playbook" ? null : f.playbookVersion,
        },
      });
    }
  }
  if (f.playbookVersion !== null)
    chips.push({
      id: "pbv",
      label: `Playbook version: v${f.playbookVersion}`,
      without: { ...f, playbookVersion: null },
    });
  if (f.readinessMin !== null || f.readinessMax !== null)
    chips.push({
      id: "readiness",
      label: `Readiness: ${f.readinessMin ?? 1}–${f.readinessMax ?? 5}`,
      without: { ...f, readinessMin: null, readinessMax: null },
    });
  return chips;
}

/** Add a constraint (used by click-through "filter to this"). */
export function withValue(f: Filter, key: FilterKey, value: string): Filter {
  const list = f.values[key] ?? [];
  if (list.includes(value)) return f;
  return { ...f, values: { ...f.values, [key]: [...list, value] } };
}
