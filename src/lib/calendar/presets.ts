import type { DomainCode } from "@/lib/domains";
import { zonedWallTimeToUtc } from "@/lib/time";

import type { IsoDate } from "./dates";
import type { EventDraft } from "./types";

/**
 * Quick-add presets. Times are defined in the release's own zone so DST in
 * either region is handled by the conversion, never by hand.
 */
export type PresetPart = {
  title: string;
  time: string; // HH:mm in `tz`
  importance: 1 | 2 | 3;
};

export type Preset = {
  key: string;
  label: string;
  group: "US data" | "Central banks" | "Energy" | "Rates" | "Other";
  domain: DomainCode;
  category: string;
  tz: string;
  instruments: string[];
  /** One release can create several events (decision + press conference). */
  parts: PresetPart[];
  /** Shown in the event notes, e.g. when the time varies. */
  note?: string;
};

const NY = "America/New_York";
const US_MACRO = ["ES", "NQ", "ZN", "6E", "GC"];

export const PRESETS: Preset[] = [
  {
    key: "nfp",
    label: "NFP (Employment Situation)",
    group: "US data",
    domain: "DATA",
    category: "Labour",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "Non-farm payrolls", time: "08:30", importance: 3 }],
  },
  {
    key: "cpi",
    label: "CPI",
    group: "US data",
    domain: "DATA",
    category: "Inflation",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "CPI", time: "08:30", importance: 3 }],
  },
  {
    key: "pce",
    label: "PCE",
    group: "US data",
    domain: "DATA",
    category: "Inflation",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "PCE price index", time: "08:30", importance: 3 }],
  },
  {
    key: "ppi",
    label: "PPI",
    group: "US data",
    domain: "DATA",
    category: "Inflation",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "PPI", time: "08:30", importance: 2 }],
  },
  {
    key: "retail",
    label: "Retail sales",
    group: "US data",
    domain: "DATA",
    category: "Growth",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "Retail sales", time: "08:30", importance: 2 }],
  },
  {
    key: "gdp",
    label: "GDP",
    group: "US data",
    domain: "DATA",
    category: "Growth",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "GDP", time: "08:30", importance: 2 }],
  },
  {
    key: "claims",
    label: "Jobless claims",
    group: "US data",
    domain: "DATA",
    category: "Labour",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "Initial jobless claims", time: "08:30", importance: 2 }],
  },
  {
    key: "ism",
    label: "ISM manufacturing / services",
    group: "US data",
    domain: "DATA",
    category: "Growth",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "ISM PMI", time: "10:00", importance: 2 }],
  },
  {
    key: "jolts",
    label: "JOLTS",
    group: "US data",
    domain: "DATA",
    category: "Labour",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "JOLTS job openings", time: "10:00", importance: 2 }],
  },
  {
    key: "fomc",
    label: "FOMC decision + presser",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "Fed",
    tz: NY,
    instruments: US_MACRO,
    parts: [
      { title: "FOMC rate decision", time: "14:00", importance: 3 },
      { title: "FOMC press conference", time: "14:30", importance: 3 },
    ],
  },
  {
    key: "fomc_minutes",
    label: "FOMC minutes",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "Fed",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "FOMC minutes", time: "14:00", importance: 2 }],
  },
  {
    key: "fed_speaker",
    label: "Fed speaker",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "Fed",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "Fed speaker", time: "10:00", importance: 1 }],
    note: "Set the actual time and speaker.",
  },
  {
    key: "jackson_hole",
    label: "Jackson Hole (Fed chair)",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "Fed",
    tz: NY,
    instruments: US_MACRO,
    parts: [{ title: "Jackson Hole — Fed chair speech", time: "10:00", importance: 3 }],
    note: "Check the published speech time.",
  },
  {
    key: "ecb",
    label: "ECB decision + presser",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "ECB",
    tz: "Europe/Berlin",
    instruments: ["FGBL", "6E", "ES"],
    parts: [
      { title: "ECB rate decision", time: "14:15", importance: 3 },
      { title: "ECB press conference", time: "14:45", importance: 3 },
    ],
  },
  {
    key: "boe",
    label: "BoE decision",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "BoE",
    tz: "Europe/London",
    instruments: ["6B"],
    parts: [{ title: "BoE rate decision", time: "12:00", importance: 3 }],
  },
  {
    key: "boj",
    label: "BoJ decision",
    group: "Central banks",
    domain: "CENTRAL_BANKS",
    category: "BoJ",
    tz: "Asia/Tokyo",
    instruments: ["6J"],
    parts: [{ title: "BoJ rate decision", time: "12:00", importance: 3 }],
    note: "BoJ has no fixed release time — adjust when announced.",
  },
  {
    key: "eia",
    label: "EIA crude (Wed 10:30 ET)",
    group: "Energy",
    domain: "DATA",
    category: "Energy inventories",
    tz: NY,
    instruments: ["CL"],
    parts: [{ title: "EIA crude inventories", time: "10:30", importance: 2 }],
  },
  {
    key: "natgas",
    label: "Nat gas storage (Thu 10:30 ET)",
    group: "Energy",
    domain: "DATA",
    category: "Energy inventories",
    tz: NY,
    instruments: ["NG"],
    parts: [{ title: "Nat gas storage (EIA)", time: "10:30", importance: 2 }],
  },
  {
    key: "api",
    label: "API crude (Tue 16:30 ET)",
    group: "Energy",
    domain: "DATA",
    category: "Energy inventories",
    tz: NY,
    instruments: ["CL"],
    parts: [{ title: "API crude inventories", time: "16:30", importance: 1 }],
  },
  ...(["2", "3", "5", "7", "10", "20", "30"] as const).map((tenor): Preset => ({
    key: `auction_${tenor}y`,
    label: `Treasury ${tenor}Y auction`,
    group: "Rates",
    domain: "DATA",
    category: "Treasury auction",
    tz: NY,
    instruments: ["ZN", "ZB", "ZF", "ZT"],
    parts: [{ title: `${tenor}-year Treasury auction`, time: "13:00", importance: 2 }],
  })),
];

export function presetByKey(key: string): Preset | undefined {
  return PRESETS.find((p) => p.key === key);
}

/** Events a preset creates on a given date (in the preset's zone). */
export function presetEvents(preset: Preset, date: IsoDate): EventDraft[] {
  return preset.parts.map((part) => ({
    starts_at: zonedWallTimeToUtc(`${date} ${part.time}`, preset.tz).toISOString(),
    native_tz: preset.tz,
    primary_domain: preset.domain,
    category: preset.category,
    title: part.title,
    importance: part.importance,
    instruments: preset.instruments,
    notes: preset.note ?? null,
    source: "preset",
  }));
}
