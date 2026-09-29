import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";

import { DEFAULT_INSTRUMENTS } from "@/lib/trading/instrument-specs";
import { computeTrade, type Direction, type TradeKind } from "@/lib/trading/pnl";
import { E2E_USER, signedIn } from "../local-supabase";

type Inst = {
  id: string;
  symbol: string;
  tick_size: number;
  tick_value: number;
  fee_per_contract: number;
  exchange_tz: string;
};

let db: SupabaseClient;
let instruments: Inst[];

beforeAll(async () => {
  ({ client: db } = await signedIn(E2E_USER));
  const { data, error } = await db
    .from("instruments")
    .select("id, symbol, tick_size, tick_value, fee_per_contract, exchange_tz")
    .is("deleted_at", null);
  if (error) throw error;
  instruments = data as Inst[];
});

describe("seeded instruments match the TypeScript specs", () => {
  it("has all 25 defaults with identical tick size and value", () => {
    for (const spec of DEFAULT_INSTRUMENTS) {
      const row = instruments.find((i) => i.symbol === spec.symbol);
      expect(row, spec.symbol).toBeDefined();
      expect(Number(row!.tick_size)).toBeCloseTo(spec.tickSize, 12);
      expect(Number(row!.tick_value)).toBe(spec.tickValue);
      expect(row!.exchange_tz).toBe(spec.exchangeTz);
    }
  });
});

// Deterministic pseudo-random so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("SQL compute_trade == TS computeTrade", () => {
  it("matches for every instrument, both directions, all kinds, across DST", async () => {
    const rand = rng(42);
    const kinds: TradeKind[] = ["taken", "missed", "observed"];
    const times = [
      "2026-01-15T14:35:12Z",
      "2026-03-20T12:10:00Z",
      "2026-07-01T06:45:30Z",
      "2026-10-28T07:05:00Z",
      "2026-01-18T23:40:00Z",
    ];
    let checked = 0;

    for (const inst of instruments) {
      const tick = Number(inst.tick_size);
      for (let i = 0; i < 4; i++) {
        const direction: Direction = rand() < 0.5 ? "long" : "short";
        const kind = kinds[i % 3];
        const base = 1000 * tick;
        const entry = base + Math.round(rand() * 400) * tick;
        const exit = base + Math.round(rand() * 400) * tick;
        const stop =
          i === 3
            ? null
            : entry + (direction === "long" ? -1 : 1) * (1 + Math.round(rand() * 20)) * tick;
        const contracts = kind === "observed" ? null : 1 + Math.floor(rand() * 5);
        const fees = i === 2 ? 3.2 : null;
        const entryAt = times[(i + checked) % times.length];
        const exitAt = new Date(
          new Date(entryAt).getTime() + Math.round(rand() * 3600) * 1000,
        ).toISOString();

        const { data, error } = await db
          .from("trades")
          .insert({
            kind,
            instrument_id: inst.id,
            direction,
            entry_at: entryAt,
            exit_at: exitAt,
            entry_price: entry,
            exit_price: exit,
            stop_price: stop,
            contracts,
            fees,
            thesis: "parity-test",
          })
          .select(
            "ticks, gross_pnl, fees_total, net_pnl, risk_usd, r_multiple, no_stop, duration_sec, weekday, time_bucket, session, day_id",
          )
          .single();
        expect(error, `${inst.symbol} ${kind}`).toBeNull();

        const ts = computeTrade(
          {
            tickSize: tick,
            tickValue: Number(inst.tick_value),
            feePerContract: Number(inst.fee_per_contract),
            exchangeTz: inst.exchange_tz,
          },
          {
            kind,
            direction,
            entryAt,
            exitAt,
            entryPrice: entry,
            exitPrice: exit,
            stopPrice: stop,
            contracts,
            fees,
          },
        );

        const num = (v: unknown) => (v === null ? null : Number(v));
        const ctx = `${inst.symbol} ${kind} ${direction} ${entryAt}`;
        expect(num(data!.ticks), ctx).toBe(ts.ticks);
        expect(num(data!.gross_pnl), ctx).toBe(ts.grossPnl);
        expect(num(data!.fees_total), ctx).toBe(ts.feesTotal);
        expect(num(data!.net_pnl), ctx).toBe(ts.netPnl);
        expect(num(data!.risk_usd), ctx).toBe(ts.riskUsd);
        expect(num(data!.r_multiple), ctx).toBe(ts.rMultiple);
        expect(data!.no_stop, ctx).toBe(ts.noStop);
        expect(data!.duration_sec, ctx).toBe(ts.durationSec);
        expect(data!.weekday, ctx).toBe(ts.weekday);
        expect(data!.time_bucket, ctx).toBe(ts.timeBucket);
        expect(data!.session, ctx).toBe(ts.session);
        const day = await db.from("trading_days").select("date").eq("id", data!.day_id).single();
        expect(day.data?.date, ctx).toBe(formatInTimeZone(entryAt, "Europe/Lisbon", "yyyy-MM-dd"));
        checked++;
      }
    }
    expect(checked).toBe(instruments.length * 4);
  });

  it("recomputes on update and snapshots the playbook version", async () => {
    const es = instruments.find((i) => i.symbol === "ES")!;
    const pb = await db.from("playbooks").select("id, version").limit(1).single();
    const ins = await db
      .from("trades")
      .insert({
        instrument_id: es.id,
        direction: "long",
        entry_at: "2026-09-15T13:40:00Z",
        entry_price: 5000,
        exit_price: 5001,
        contracts: 1,
        playbook_id: pb.data!.id,
      })
      .select("id, net_pnl, playbook_version")
      .single();
    expect(Number(ins.data!.net_pnl)).toBe(50);
    expect(ins.data!.playbook_version).toBe(pb.data!.version);

    const upd = await db
      .from("trades")
      .update({ exit_price: 5003 })
      .eq("id", ins.data!.id)
      .select("net_pnl")
      .single();
    expect(Number(upd.data!.net_pnl)).toBe(150);
  });

  it("computes minutes relative to a linked event", async () => {
    const es = instruments.find((i) => i.symbol === "ES")!;
    const ev = await db
      .from("calendar_events")
      .insert({
        starts_at: "2026-09-15T12:30:00Z",
        primary_domain: "DATA",
        category: "CPI",
        title: "CPI (test)",
      })
      .select("id")
      .single();
    const t = await db
      .from("trades")
      .insert({
        instrument_id: es.id,
        direction: "short",
        entry_at: "2026-09-15T12:33:00Z",
        entry_price: 5000,
        contracts: 1,
        calendar_event_id: ev.data!.id,
      })
      .select("minutes_from_event")
      .single();
    expect(t.data!.minutes_from_event).toBe(3);
  });

  it("rejects invalid vocabularies", async () => {
    const es = instruments.find((i) => i.symbol === "ES")!;
    const bad = await db.from("trades").insert({
      instrument_id: es.id,
      direction: "long",
      entry_at: "2026-09-15T13:40:00Z",
      entry_price: 5000,
      contracts: 1,
      primary_domain: "ASTROLOGY",
    });
    expect(bad.error).not.toBeNull();

    const noSize = await db.from("trades").insert({
      kind: "taken",
      instrument_id: es.id,
      direction: "long",
      entry_at: "2026-09-15T13:40:00Z",
      entry_price: 5000,
    });
    expect(noSize.error).not.toBeNull();
  });
});
