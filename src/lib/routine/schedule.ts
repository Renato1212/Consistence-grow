/**
 * The routine laid out on a trading day: each block's UTC window (from its
 * native time zone), which block is now / next, the news gate's qualifying
 * events, and per-block guardrails from the day's trades. Pure and DST-safe.
 */
import type { HolidayCalendar } from "@/lib/calendar/holidays";
import { isWeekend, type IsoDate } from "@/lib/calendar/dates";
import { zonedWallTimeToUtc } from "@/lib/time";

import type { Routine, RoutineBlock } from "./routine";

export type BlockInstance = RoutineBlock & {
  startAt: string;
  endAt: string;
  /** Shortened by an early close. */
  clipped: boolean;
};

export type BlockStatus = "past" | "now" | "next" | "later";

/** Blocks scheduled on `date` (holidays and early closes applied), in time order. */
export function blocksForDay(
  routine: Routine,
  date: IsoDate,
  cal?: HolidayCalendar,
): BlockInstance[] {
  if (isWeekend(date)) return [];
  const usClosed = cal?.isClosed(date, "US") ?? false;
  const ukClosed = cal?.isClosed(date, "UK") ?? false;
  const early = cal?.earlyClose(date, "US") ?? null;
  const earlyAt = early ? zonedWallTimeToUtc(`${date} ${early}`, "America/New_York") : null;

  const out: BlockInstance[] = [];
  for (const b of routine.blocks) {
    if (!b.enabled) continue;
    if (b.session === "US" && usClosed) continue;
    if (b.session === "EU" && ukClosed) continue;
    const start = zonedWallTimeToUtc(`${date} ${b.start}`, b.tz);
    let end = zonedWallTimeToUtc(`${date} ${b.end}`, b.tz);
    let clipped = false;
    if (earlyAt && b.session === "US" && b.kind === "trade") {
      if (start >= earlyAt) continue;
      if (end > earlyAt) {
        end = earlyAt;
        clipped = true;
      }
    }
    out.push({ ...b, startAt: start.toISOString(), endAt: end.toISOString(), clipped });
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Status of every block at `now`: the running one is "now", the first upcoming one "next". */
export function blockStatuses(blocks: BlockInstance[], now: Date): Map<string, BlockStatus> {
  const t = now.toISOString();
  const out = new Map<string, BlockStatus>();
  let nextGiven = false;
  for (const b of blocks) {
    if (t >= b.endAt) out.set(b.key, "past");
    else if (t >= b.startAt) out.set(b.key, "now");
    else if (!nextGiven) {
      out.set(b.key, "next");
      nextGiven = true;
    } else out.set(b.key, "later");
  }
  return out;
}

/** The block to show open: the running one, else the next, else the last. */
export function focusBlock(blocks: BlockInstance[], now: Date): BlockInstance | null {
  const st = blockStatuses(blocks, now);
  return (
    blocks.find((b) => st.get(b.key) === "now") ??
    blocks.find((b) => st.get(b.key) === "next") ??
    blocks.at(-1) ??
    null
  );
}

export type GateEvent = { id: string; title: string; startsAt: string; importance: number };

/** Calendar events inside a "news" block's window at or above the routine's importance. */
export function qualifyingEvents<E extends GateEvent>(
  block: BlockInstance,
  events: E[],
  minImportance: number,
): E[] {
  return events
    .filter(
      (e) =>
        e.importance >= minImportance && e.startsAt >= block.startAt && e.startsAt < block.endAt,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type GuardTrade = {
  id: string;
  playbookId: string | null;
  entryAt: string;
  timeEstimated: boolean;
  net: number | null;
};

export type BlockUsage = {
  trades: number;
  net: number;
  /** Trades / loss limit reached. */
  tradesLeft: number | null;
  lossLeft: number | null;
  stopped: boolean;
  reason: "trades" | "loss" | null;
};

/**
 * A trade belongs to a trade block when it carries the block's setup, or
 * (without a setup and with a real time) when it was entered inside the window.
 */
export function tradesInBlock<T extends GuardTrade>(block: BlockInstance, trades: T[]): T[] {
  return trades.filter((t) =>
    t.playbookId
      ? t.playbookId === block.playbookId
      : !t.timeEstimated && t.entryAt >= block.startAt && t.entryAt < block.endAt,
  );
}

export function blockUsage(block: BlockInstance, trades: GuardTrade[]): BlockUsage {
  const mine = tradesInBlock(block, trades);
  const net = Math.round(mine.reduce((s, t) => s + (t.net ?? 0), 0) * 100) / 100;
  const tradesLeft = block.maxTrades === null ? null : Math.max(0, block.maxTrades - mine.length);
  const lossLeft =
    block.maxLossUsd === null ? null : Math.max(0, block.maxLossUsd + Math.min(0, net));
  const reason = tradesLeft === 0 ? "trades" : lossLeft !== null && lossLeft <= 0 ? "loss" : null;
  return { trades: mine.length, net, tradesLeft, lossLeft, stopped: reason !== null, reason };
}

/** Whole-day stop: net P/L of the day at or below −dayMaxLossUsd. */
export function dayStopped(routine: Pick<Routine, "dayMaxLossUsd">, trades: GuardTrade[]): boolean {
  if (routine.dayMaxLossUsd === null) return false;
  const net = trades.reduce((s, t) => s + (t.net ?? 0), 0);
  return net <= -routine.dayMaxLossUsd;
}

/** Block of a setup (for defaults when logging a trade from it). */
export function blockForPlaybook(routine: Routine, playbookId: string | null) {
  return routine.blocks.find((b) => b.kind === "trade" && b.playbookId === playbookId) ?? null;
}
