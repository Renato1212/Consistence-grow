"use client";

import { useEffect, useState } from "react";
import { Controller, type Control } from "react-hook-form";

import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/ui/native-select";
import { addDays } from "@/lib/calendar/dates";
import { lisbonTime } from "@/lib/calendar/display";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, zonedWallTimeToUtc } from "@/lib/time";
import { localInputToIso, type TradeFormValues } from "@/lib/trading/trade-form";

type Options = {
  events: { id: string; label: string; startsAt: string }[];
  scenarios: { id: string; label: string }[];
  levels: { id: string; label: string; instrumentId: string }[];
};

const EMPTY: Options = { events: [], scenarios: [], levels: [] };

async function loadOptions(date: string): Promise<Options> {
  const supabase = createClient();
  const from = zonedWallTimeToUtc(`${date} 00:00`, DISPLAY_TZ).toISOString();
  const to = zonedWallTimeToUtc(`${addDays(date, 1)} 00:00`, DISPLAY_TZ).toISOString();
  const [events, preps] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("id, title, starts_at")
      .is("deleted_at", null)
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at"),
    supabase
      .from("session_preps")
      .select("id, session, trading_days!inner(date)")
      .eq("trading_days.date", date)
      .is("deleted_at", null),
  ]);
  if (events.error) throw events.error;
  if (preps.error) throw preps.error;
  const prepIds = (preps.data ?? []).map((p) => p.id);
  const session = new Map((preps.data ?? []).map((p) => [p.id, p.session]));
  let scenarios: Options["scenarios"] = [];
  let levels: Options["levels"] = [];
  if (prepIds.length) {
    const [sc, lv] = await Promise.all([
      supabase
        .from("scenarios")
        .select("id, prep_id, if_text, direction")
        .in("prep_id", prepIds)
        .is("deleted_at", null)
        .order("sort"),
      supabase
        .from("key_levels")
        .select("id, prep_id, instrument_id, price_low, price_high, level_type, strength")
        .in("prep_id", prepIds)
        .is("deleted_at", null)
        .order("strength", { ascending: false }),
    ]);
    if (sc.error) throw sc.error;
    if (lv.error) throw lv.error;
    scenarios = (sc.data ?? []).map((s) => ({
      id: s.id,
      label:
        `${session.get(s.prep_id)} · ${s.direction ? `${s.direction} · ` : ""}If ${s.if_text}`.slice(
          0,
          90,
        ),
    }));
    levels = (lv.data ?? []).map((l) => ({
      id: l.id,
      instrumentId: l.instrument_id,
      label: `${session.get(l.prep_id)} · ${l.price_low}${l.price_high ? `–${l.price_high}` : ""} ${l.level_type} (${l.strength})`,
    }));
  }
  return {
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      startsAt: e.starts_at,
      label: `${lisbonTime(e.starts_at)} ${e.title}`,
    })),
    scenarios,
    levels,
  };
}

/**
 * Link a trade to the day's calendar event, prep scenario and key level.
 * Options come from the entry date; minutes-from-event is computed by the
 * database on save (shown here as a preview).
 */
export function TradeLinks({
  control,
  entryAt,
  instrumentId,
  eventId,
}: {
  control: Control<TradeFormValues>;
  entryAt: string;
  instrumentId: string;
  eventId: string;
}) {
  const date = /^\d{4}-\d{2}-\d{2}/.test(entryAt) ? entryAt.slice(0, 10) : null;
  const [loaded, setLoaded] = useState<{ date: string; options: Options } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    loadOptions(date)
      .then((options) => {
        if (!cancelled) {
          setLoaded({ date, options });
          setFailed(false);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        logClientError("trade.links", e, { date });
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const options = loaded && loaded.date === date ? loaded.options : EMPTY;
  const entryIso = localInputToIso(entryAt);
  const ev = options.events.find((e) => e.id === eventId);
  const minutes =
    ev && entryIso ? Math.round((Date.parse(entryIso) - Date.parse(ev.startsAt)) / 60000) : null;
  const levels = options.levels.filter((l) => l.instrumentId === instrumentId);

  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="trade-links">
      <Field
        id="calendarEventId"
        label="Event"
        hint={minutes !== null ? ` · ${minutes > 0 ? "+" : ""}${minutes} min` : undefined}
      >
        <Controller
          control={control}
          name="calendarEventId"
          render={({ field }) => (
            <NativeSelect
              id="calendarEventId"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
            >
              <option value="">{options.events.length ? "—" : "No events that day"}</option>
              {field.value && !options.events.some((e) => e.id === field.value) && (
                <option value={field.value}>Linked event</option>
              )}
              {options.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </NativeSelect>
          )}
        />
      </Field>
      <Field id="scenarioId" label="Scenario">
        <Controller
          control={control}
          name="scenarioId"
          render={({ field }) => (
            <NativeSelect
              id="scenarioId"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
            >
              <option value="">{options.scenarios.length ? "—" : "No prep scenarios"}</option>
              {field.value && !options.scenarios.some((s) => s.id === field.value) && (
                <option value={field.value}>Linked scenario</option>
              )}
              {options.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          )}
        />
      </Field>
      <Field id="keyLevelId" label="Key level">
        <Controller
          control={control}
          name="keyLevelId"
          render={({ field }) => (
            <NativeSelect
              id="keyLevelId"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
            >
              <option value="">{levels.length ? "—" : "No levels for this instrument"}</option>
              {field.value && !levels.some((l) => l.id === field.value) && (
                <option value={field.value}>Linked level</option>
              )}
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </NativeSelect>
          )}
        />
      </Field>
      {failed && (
        <p className="text-muted-foreground col-span-full text-xs">
          Couldn&apos;t load the day&apos;s events and prep — links can be added later.
        </p>
      )}
    </div>
  );
}
