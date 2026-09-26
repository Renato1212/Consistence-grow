"use client";

import { useState } from "react";
import { ArrowDownWideNarrow, CornerDownRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { EditorInstrument } from "@/lib/data/editor";
import { LEVEL_TYPES, sortLevels, type LevelDraft } from "@/lib/prep/prep-form";
import { cn } from "@/lib/utils";

const STRENGTH_ROW = {
  3: "border-l-primary border-l-4 font-semibold",
  2: "border-l-4 border-l-foreground/30",
  1: "border-l-4 border-l-transparent text-muted-foreground",
} as const;

/**
 * Key levels per instrument. Strength drives visual weight; strength-3 rows
 * come first (on load, carry forward and "Sort"), and 1s can be hidden.
 * Rows are not re-sorted while typing, so nothing jumps under the cursor.
 */
export function LevelsEditor({
  levels,
  onChange,
  instruments,
  defaultInstrumentId,
  issues,
  carry,
}: {
  levels: LevelDraft[];
  onChange: (levels: LevelDraft[]) => void;
  instruments: EditorInstrument[];
  defaultInstrumentId: string;
  issues: Map<string, string>;
  carry: { date: string; count: number; run: () => void } | null;
}) {
  const [hideWeak, setHideWeak] = useState(false);
  const active = instruments.filter((i) => i.active);
  const symbol = new Map(instruments.map((i) => [i.id, i.symbol]));
  const patch = (id: string, p: Partial<LevelDraft>) =>
    onChange(levels.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const weak = levels.filter((l) => l.strength === 1).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...levels,
              {
                id: crypto.randomUUID(),
                instrumentId: defaultInstrumentId,
                priceLow: "",
                priceHigh: "",
                levelType: "",
                strength: 2,
                note: "",
                carriedFromId: null,
              },
            ])
          }
        >
          <Plus aria-hidden />
          Add level
        </Button>
        {carry && carry.count > 0 && (
          <Button variant="outline" size="sm" onClick={carry.run}>
            <CornerDownRight aria-hidden />
            Carry forward {carry.count} untested from {carry.date.slice(5)}
          </Button>
        )}
        {levels.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(sortLevels(levels))}>
            <ArrowDownWideNarrow aria-hidden />
            Strongest first
          </Button>
        )}
        {weak > 0 && (
          <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={hideWeak}
              onChange={(e) => setHideWeak(e.target.checked)}
            />
            Hide strength 1 ({weak})
          </label>
        )}
      </div>

      {levels.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No levels yet. Keep it to the few that matter — mark the strongest as 3.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="levels">
          {levels.map((l) => {
            if (hideWeak && l.strength === 1) return null;
            const err = issues.get(l.id);
            const incomplete = !l.priceLow.trim() || !l.levelType.trim();
            return (
              <li
                key={l.id}
                data-testid="level-row"
                data-strength={l.strength}
                className={cn(
                  "bg-background grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[6rem_7rem_7rem_9rem_auto_1fr_auto]",
                  STRENGTH_ROW[l.strength],
                )}
              >
                <NativeSelect
                  aria-label="Instrument"
                  value={l.instrumentId}
                  onChange={(e) => patch(l.id, { instrumentId: e.target.value })}
                >
                  {!symbol.has(l.instrumentId) && <option value="">—</option>}
                  {instruments
                    .filter((i) => i.active || i.id === l.instrumentId)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.symbol}
                      </option>
                    ))}
                </NativeSelect>
                <Input
                  aria-label="Price (or zone low)"
                  placeholder="Price"
                  inputMode="decimal"
                  className="num"
                  value={l.priceLow}
                  aria-invalid={!!err}
                  onChange={(e) => patch(l.id, { priceLow: e.target.value })}
                />
                <Input
                  aria-label="Zone high (optional)"
                  placeholder="Zone high"
                  inputMode="decimal"
                  className="num"
                  value={l.priceHigh}
                  onChange={(e) => patch(l.id, { priceHigh: e.target.value })}
                />
                <Input
                  aria-label="Level type"
                  placeholder="Type"
                  list="level-types"
                  value={l.levelType}
                  onChange={(e) => patch(l.id, { levelType: e.target.value })}
                />
                <Segmented
                  label="Strength"
                  size="sm"
                  value={String(l.strength) as "1" | "2" | "3"}
                  onChange={(v) => patch(l.id, { strength: Number(v) as 1 | 2 | 3 })}
                  options={[
                    { value: "1", label: "1" },
                    { value: "2", label: "2" },
                    { value: "3", label: "3" },
                  ]}
                />
                <Input
                  aria-label="Note"
                  placeholder={l.carriedFromId ? "Carried — note" : "Note"}
                  value={l.note}
                  onChange={(e) => patch(l.id, { note: e.target.value })}
                  className="order-last col-span-2 sm:order-none sm:col-span-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="justify-self-end"
                  aria-label="Remove level"
                  onClick={() => onChange(levels.filter((x) => x.id !== l.id))}
                >
                  <Trash2 aria-hidden />
                </Button>
                {(err || incomplete) && (
                  <p
                    className={cn(
                      "order-last col-span-full text-xs sm:order-none",
                      err ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {err ?? "Needs a price and a type to be saved."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <datalist id="level-types">
        {LEVEL_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {active.length === 0 && (
        <p className="text-muted-foreground text-xs">Activate instruments in Settings first.</p>
      )}
    </div>
  );
}
