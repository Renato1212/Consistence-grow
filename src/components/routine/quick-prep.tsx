"use client";

import { useState } from "react";
import Link from "next/link";

import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import type { QuickPrep } from "@/lib/data/routine";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PrepInstrument = { id: string; symbol: string; name: string };
type Bias = "long" | "short" | "neutral";

const BIAS_OPTIONS: { value: Bias; label: string }[] = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "neutral", label: "Neutral" },
];

/**
 * The 60-second prep: one-line narrative (prefilled from the Pre-Open's
 * TL;DR), the instruments to watch and a bias for each. Autosaved.
 */
export function QuickPrepForm({
  date,
  session,
  initial,
  suggestion,
  instruments,
  onChange,
  save,
}: {
  date: string;
  session: "EU" | "US";
  initial: QuickPrep | undefined;
  /** Narrative from the brief's TL;DR, used while the prep is empty. */
  suggestion: string;
  instruments: PrepInstrument[];
  onChange: (prep: QuickPrep) => void;
  save: (key: string, run: () => PromiseLike<{ error: unknown }>, immediate?: boolean) => void;
}) {
  const [prep, setPrep] = useState<QuickPrep>(
    () =>
      initial ?? {
        narrative: suggestion,
        instrumentIds: [],
        bias: {},
        completed: false,
      },
  );

  function update(next: QuickPrep, immediate = false) {
    setPrep(next);
    onChange(next);
    save(
      `prep:${session}`,
      () =>
        createClient().rpc("save_quick_prep", {
          p_date: date,
          p_session: session,
          p_narrative: next.narrative,
          p_instrument_ids: next.instrumentIds,
          p_bias: Object.fromEntries(
            Object.entries(next.bias).filter(([id]) => next.instrumentIds.includes(id)),
          ),
        }),
      immediate,
    );
  }

  function toggle(id: string) {
    const on = prep.instrumentIds.includes(id);
    update(
      {
        ...prep,
        instrumentIds: on
          ? prep.instrumentIds.filter((x) => x !== id)
          : [...prep.instrumentIds, id],
      },
      true,
    );
  }

  const fieldId = `quick-narrative-${session}`;
  return (
    <div className="space-y-3" data-testid={`quick-prep-${session.toLowerCase()}`}>
      <div className="space-y-1">
        <label htmlFor={fieldId} className="text-xs font-medium">
          Narrative in one line
        </label>
        <Textarea
          id={fieldId}
          rows={2}
          value={prep.narrative}
          placeholder="What is the market trading on today?"
          onChange={(e) => update({ ...prep, narrative: e.target.value })}
        />
        {!initial && suggestion && (
          <p className="text-muted-foreground text-xs">Prefilled from the Pre-Open TL;DR.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium" id={`quick-inst-${session}`}>
          Instruments in the narrative
        </p>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-labelledby={`quick-inst-${session}`}
        >
          {instruments.map((i) => {
            const on = prep.instrumentIds.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                aria-pressed={on}
                title={i.name}
                onClick={() => toggle(i.id)}
                className={cn(
                  "num h-9 min-w-12 rounded-md border px-2.5 text-xs font-semibold transition-colors",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i.symbol}
              </button>
            );
          })}
        </div>
      </div>

      {prep.instrumentIds.length > 0 && (
        <ul className="space-y-2">
          {prep.instrumentIds.map((id) => {
            const inst = instruments.find((i) => i.id === id);
            if (!inst) return null;
            return (
              <li key={id} className="flex flex-wrap items-center gap-2">
                <span className="num w-14 text-xs font-semibold">{inst.symbol}</span>
                <Segmented
                  size="sm"
                  label={`${inst.symbol} bias`}
                  value={prep.bias[id] ?? null}
                  onChange={(v) => update({ ...prep, bias: { ...prep.bias, [id]: v } }, true)}
                  options={BIAS_OPTIONS}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs">
        <Link
          href={`/prep/${date}/${session.toLowerCase()}`}
          className="text-primary-ink hover:underline"
        >
          Full {session} prep (levels, scenarios, risk) →
        </Link>
      </p>
    </div>
  );
}
