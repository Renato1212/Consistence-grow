import { DIMENSION_BY_KEY, type DimensionKey } from "./dimensions";
import { filterToQuery, type Filter } from "./filters";

/** Insights tab and breakdown dimension, kept in the URL next to the filter. */
export const TABS = [
  "overview",
  "breakdowns",
  "patterns",
  "process",
  "plan",
  "broker",
  "ai",
] as const;
export type Tab = (typeof TABS)[number];
export const DEFAULT_DIMENSION: DimensionKey = "domain";

export function parseTab(v: string | null): Tab {
  return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "overview";
}

export function parseDimension(v: string | null): DimensionKey {
  return v && v in DIMENSION_BY_KEY ? (v as DimensionKey) : DEFAULT_DIMENSION;
}

export function insightsQuery(filter: Filter, tab: Tab, dimension: DimensionKey): string {
  const q = filterToQuery(filter);
  if (tab !== "overview") q.set("tab", tab);
  if (tab === "breakdowns" && dimension !== DEFAULT_DIMENSION) q.set("by", dimension);
  const s = q.toString();
  return s ? `?${s}` : "";
}
