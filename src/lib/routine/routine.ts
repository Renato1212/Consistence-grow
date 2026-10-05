/**
 * The trader's daily routine: prep blocks (read, check charts, 60-second prep)
 * and trade blocks (one setup each), stored in `user_settings.routine`.
 * Times are wall-clock times in each block's own market time zone, so the
 * Lisbon times move by themselves when only one side changes its clocks.
 */
import { z } from "zod";

export const STEP_KINDS = ["link", "brief", "charts", "prep", "check"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const BLOCK_KINDS = ["prep", "trade", "debrief"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** news: trade only around qualifying calendar events; bias: answer the 3-question check first. */
export const GATES = ["none", "news", "bias"] as const;
export type Gate = (typeof GATES)[number];

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const stepSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(STEP_KINDS),
  label: z.string().trim().min(1).max(120),
  url: z.union([z.literal(""), z.url().max(500)]).optional(),
});
export type RoutineStep = z.infer<typeof stepSchema>;

export const blockSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z0-9_]{1,40}$/, "Lowercase letters, digits and _ only")
      .min(1),
    title: z.string().trim().min(1).max(80),
    kind: z.enum(BLOCK_KINDS),
    session: z.enum(["EU", "US"]),
    start: HHMM,
    end: HHMM,
    tz: z.enum(["Europe/London", "America/New_York", "Europe/Lisbon"]),
    steps: z.array(stepSchema).max(12),
    playbookId: z.uuid().nullable(),
    gate: z.enum(GATES),
    maxTrades: z.number().int().min(0).max(100).nullable(),
    maxLossUsd: z.number().min(0).max(1_000_000).nullable(),
    enabled: z.boolean(),
  })
  .refine((b) => b.start < b.end, { message: "End must be after start", path: ["end"] });
export type RoutineBlock = z.infer<typeof blockSchema>;

export const routineSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(blockSchema).min(1).max(20),
    /** Stop trading for the day below this net loss (USD). */
    dayMaxLossUsd: z.number().min(0).max(1_000_000).nullable(),
    /** Calendar events at or above this importance qualify for a "news" block. */
    newsMinImportance: z.number().int().min(1).max(3),
    /** Browser alert this many minutes before a block starts (0 = off). */
    alertMinutes: z.number().int().min(0).max(60),
  })
  .refine((r) => new Set(r.blocks.map((b) => b.key)).size === r.blocks.length, {
    message: "Block keys must be unique",
    path: ["blocks"],
  });
export type Routine = z.infer<typeof routineSchema>;

/** Names of the four setup playbooks the default routine links to. */
export const SETUP_NAMES = {
  euNews: "EU news event",
  usOpen: "US open — 1h plan",
  scalp: "Midday scalp — 1-min supply/demand",
  moc: "MOC — 5-min breakout",
} as const;

export const MORNING_BID_EU =
  "https://www.reuters.com/site-search/?query=%22Morning+Bid%22+Europe&sort=newest";
export const MORNING_BID_US =
  "https://www.reuters.com/site-search/?query=%22Morning+Bid%22+US&sort=newest";

/**
 * The routine as described by the trader (Lisbon times in comments; the
 * stored times are native so DST gaps resolve by themselves).
 */
export function defaultRoutine(
  setups: Partial<Record<keyof typeof SETUP_NAMES, string>> = {},
): Routine {
  const prepSteps = (s: "EU" | "US"): RoutineStep[] => [
    {
      id: `${s.toLowerCase()}_bid`,
      kind: "link",
      label: s === "EU" ? "Read Reuters Morning Bid Europe" : "Read Reuters Morning Bid US",
      url: s === "EU" ? MORNING_BID_EU : MORNING_BID_US,
    },
    {
      id: `${s.toLowerCase()}_brief`,
      kind: "brief",
      label: s === "EU" ? "Read Claude Pre-Open (EU)" : "Read Claude Pre-Open (US)",
    },
    {
      id: `${s.toLowerCase()}_charts`,
      kind: "charts",
      label: "Check 1h charts of the instruments in today's narrative",
    },
    {
      id: `${s.toLowerCase()}_prep`,
      kind: "prep",
      label: "60-second prep: narrative, instruments, bias",
    },
  ];
  return {
    version: 1,
    dayMaxLossUsd: null,
    newsMinImportance: 3,
    alertMinutes: 5,
    blocks: [
      {
        // 07:15–08:00 Lisbon
        key: "eu_prep",
        title: "EU prep",
        kind: "prep",
        session: "EU",
        start: "07:15",
        end: "08:00",
        tz: "Europe/London",
        steps: prepSteps("EU"),
        playbookId: null,
        gate: "none",
        maxTrades: null,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 08:00–13:00 Lisbon
        key: "eu_news",
        title: "EU news trades",
        kind: "trade",
        session: "EU",
        start: "08:00",
        end: "13:00",
        tz: "Europe/London",
        steps: [],
        playbookId: setups.euNews ?? null,
        gate: "news",
        maxTrades: 2,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 13:00–14:25 Lisbon (normally)
        key: "us_prep",
        title: "US prep",
        kind: "prep",
        session: "US",
        start: "08:00",
        end: "09:25",
        tz: "America/New_York",
        steps: prepSteps("US"),
        playbookId: null,
        gate: "none",
        maxTrades: null,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 14:30–15:30 Lisbon (normally)
        key: "us_open",
        title: "US open (1h plan)",
        kind: "trade",
        session: "US",
        start: "09:30",
        end: "10:30",
        tz: "America/New_York",
        steps: [{ id: "open_plan", kind: "check", label: "Open plan from the 1h chart written" }],
        playbookId: setups.usOpen ?? null,
        gate: "none",
        maxTrades: 2,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 17:00–20:00 Lisbon (normally)
        key: "us_scalp",
        title: "Midday scalp (1-min S/D)",
        kind: "trade",
        session: "US",
        start: "12:00",
        end: "15:00",
        tz: "America/New_York",
        steps: [],
        playbookId: setups.scalp ?? null,
        gate: "bias",
        maxTrades: 6,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 20:50–21:00 Lisbon (normally)
        key: "moc",
        title: "MOC breakout (5-min)",
        kind: "trade",
        session: "US",
        start: "15:50",
        end: "16:00",
        tz: "America/New_York",
        steps: [{ id: "moc_imbalance", kind: "check", label: "MOC imbalance read at 15:50 ET" }],
        playbookId: setups.moc ?? null,
        gate: "none",
        maxTrades: 1,
        maxLossUsd: null,
        enabled: true,
      },
      {
        // 21:05–21:30 Lisbon (normally)
        key: "debrief",
        title: "2-minute debrief",
        kind: "debrief",
        session: "US",
        start: "16:05",
        end: "16:30",
        tz: "America/New_York",
        steps: [],
        playbookId: null,
        gate: "none",
        maxTrades: null,
        maxLossUsd: null,
        enabled: true,
      },
    ],
  };
}

/** The stored routine if it is valid, else the default (never throws). */
export function parseRoutine(raw: unknown, fallback: Routine = defaultRoutine()): Routine {
  const r = routineSchema.safeParse(raw);
  return r.success ? r.data : fallback;
}

/** Playbook ids of the routine's trade blocks (the "setups"), in block order. */
export function setupPlaybookIds(r: Routine): string[] {
  const out: string[] = [];
  for (const b of r.blocks)
    if (b.enabled && b.kind === "trade" && b.playbookId && !out.includes(b.playbookId))
      out.push(b.playbookId);
  return out;
}
