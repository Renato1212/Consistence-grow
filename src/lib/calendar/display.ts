import { DISPLAY_TZ, formatInTz } from "@/lib/time";

export const EVENT_TZ_OPTIONS = [
  { id: "America/New_York", label: "New York (ET)", short: "NY" },
  { id: "America/Chicago", label: "Chicago (CT)", short: "CHI" },
  { id: "Europe/London", label: "London", short: "LDN" },
  { id: "Europe/Berlin", label: "Frankfurt (CET)", short: "FRA" },
  { id: "Europe/Lisbon", label: "Lisbon", short: "LIS" },
  { id: "Asia/Tokyo", label: "Tokyo", short: "TYO" },
] as const;

export function tzShort(tz: string): string {
  return EVENT_TZ_OPTIONS.find((o) => o.id === tz)?.short ?? tz.split("/").pop() ?? tz;
}

/** "14:30" in Lisbon. */
export function lisbonTime(iso: string): string {
  return formatInTz(iso, DISPLAY_TZ, "HH:mm");
}

/**
 * "08:30 NY" when the native zone's wall clock differs from Lisbon's, else
 * null (London always shares Lisbon's clock).
 */
export function nativeTime(iso: string, tz: string): string | null {
  if (tz === DISPLAY_TZ || tz === "Europe/London") return null;
  return `${formatInTz(iso, tz, "HH:mm")} ${tzShort(tz)}`;
}

export const IMPORTANCE_LABEL = { 1: "Low", 2: "Medium", 3: "High" } as const;

export const EVENT_CATEGORIES = [
  "Inflation",
  "Labour",
  "Growth",
  "Fed",
  "ECB",
  "BoE",
  "BoJ",
  "Energy inventories",
  "Treasury auction",
  "Options expiration",
  "Rebalancing",
  "London fix",
  "Headline",
  "Earnings",
  "Geopolitics",
  "Other",
];
