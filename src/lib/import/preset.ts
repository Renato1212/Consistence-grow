import { z } from "zod";

import { DATE_FORMATS, DEFAULT_MAPPING, FILL_FIELDS, type ImportMapping } from "./parse";

const schema = z.object({
  columns: z
    .record(z.string(), z.string().nullable())
    .transform((c) =>
      Object.fromEntries(
        Object.entries(c).filter(([k]) => (FILL_FIELDS as readonly string[]).includes(k)),
      ),
    )
    .catch({}),
  dateFormat: z.enum(DATE_FORMATS).catch("auto-iso"),
  timezone: z.string().min(1).max(64).catch(DEFAULT_MAPPING.timezone),
  decimal: z.enum([".", ","]).catch("."),
  symbolMap: z.record(z.string(), z.string()).catch({}),
});

/** A stored preset (import_presets.mapping), validated with safe defaults. */
export function normalizeMapping(raw: unknown): ImportMapping {
  const r = schema.safeParse(raw ?? {});
  return r.success ? (r.data as ImportMapping) : DEFAULT_MAPPING;
}

export const TIMEZONES = [
  { value: "America/Chicago", label: "Chicago (CME)" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Lisbon", label: "Lisbon" },
  { value: "Europe/Berlin", label: "Frankfurt / Eurex" },
  { value: "UTC", label: "UTC" },
];
