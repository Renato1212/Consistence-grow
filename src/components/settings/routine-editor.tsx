"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useBlockAlertsPref } from "@/components/routine/block-alerts";
import { SaveStatus } from "@/components/trade/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { useSaveQueue } from "@/lib/hooks/use-save-queue";
import {
  routineSchema,
  STEP_KINDS,
  type Routine,
  type RoutineBlock,
  type RoutineStep,
} from "@/lib/routine/routine";
import { blocksForDay } from "@/lib/routine/schedule";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import type { Json } from "@/lib/supabase/database.types";

const TZ_OPTIONS = [
  { value: "Europe/London", label: "London" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/Lisbon", label: "Lisbon" },
] as const;
const STEP_LABEL: Record<RoutineStep["kind"], string> = {
  link: "Link to read",
  brief: "Claude Pre-Open",
  charts: "Check charts",
  prep: "60-second prep",
  check: "Checkbox",
};

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

/**
 * Edit the daily routine. Times are entered in each block's market time zone
 * (so the Lisbon times shift by themselves when only one side changes its
 * clocks); the Lisbon time for a sample day is shown next to each block.
 */
export function RoutineEditor({
  initial,
  fallback,
  setups,
  sampleDate,
}: {
  initial: Routine;
  fallback: Routine;
  setups: { id: string; name: string }[];
  /** A weekday to preview Lisbon times on. */
  sampleDate: string;
}) {
  const [routine, setRoutine] = useState<Routine>(initial);
  const { status, save, retry } = useSaveQueue(1000);
  const alerts = useBlockAlertsPref();

  const check = useMemo(() => routineSchema.safeParse(routine), [routine]);
  const issues = check.success ? [] : check.error.issues.map((i) => i.message);
  const preview = useMemo(() => {
    if (!check.success) return new Map<string, string>();
    return new Map(
      blocksForDay(check.data, sampleDate).map((b) => [
        b.key,
        `${formatInTz(b.startAt, DISPLAY_TZ, "HH:mm")}–${formatInTz(b.endAt, DISPLAY_TZ, "HH:mm")}`,
      ]),
    );
  }, [check, sampleDate]);

  function commit(next: Routine, immediate = false) {
    setRoutine(next);
    const parsed = routineSchema.safeParse(next);
    if (!parsed.success) return; // shown inline; nothing is saved until it is valid
    save(
      "routine",
      () =>
        createClient()
          .from("user_settings")
          .update({ routine: parsed.data as unknown as Json })
          .not("id", "is", null),
      immediate,
    );
  }

  const setBlock = (i: number, patch: Partial<RoutineBlock>, immediate = false) =>
    commit(
      { ...routine, blocks: routine.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) },
      immediate,
    );

  function move(i: number, d: -1 | 1) {
    const blocks = [...routine.blocks];
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    commit({ ...routine, blocks }, true);
  }

  function addBlock() {
    commit(
      {
        ...routine,
        blocks: [
          ...routine.blocks,
          {
            key: uid("block"),
            title: "New block",
            kind: "trade",
            session: "US",
            start: "10:30",
            end: "11:30",
            tz: "America/New_York",
            steps: [],
            playbookId: null,
            gate: "none",
            maxTrades: null,
            maxLossUsd: null,
            enabled: true,
          },
        ],
      },
      true,
    );
  }

  function removeBlock(i: number) {
    const before = routine;
    commit({ ...routine, blocks: routine.blocks.filter((_, j) => j !== i) }, true);
    toast(`Removed ${before.blocks[i].title}`, {
      action: { label: "Undo", onClick: () => commit(before, true) },
    });
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <div className="space-y-6" data-testid="routine-editor">
      <div className="flex flex-wrap items-center gap-2">
        <SaveStatus status={status === "idle" ? "saved" : status} onRetry={retry} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            commit(fallback, true);
            toast("Routine reset to the default");
          }}
        >
          <RotateCcw aria-hidden />
          Reset to default
        </Button>
      </div>

      {issues.length > 0 && (
        <ul
          className="bg-destructive/10 text-destructive space-y-1 rounded-lg p-3 text-sm"
          role="alert"
          data-testid="routine-issues"
        >
          {[...new Set(issues)].map((m) => (
            <li key={m}>{m} — not saved yet.</li>
          ))}
        </ul>
      )}

      <section className="bg-card grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium">Daily loss limit ($)</span>
          <Input
            inputMode="decimal"
            placeholder="none"
            value={routine.dayMaxLossUsd ?? ""}
            onChange={(e) => commit({ ...routine, dayMaxLossUsd: num(e.target.value) })}
          />
        </label>
        <div className="grid gap-1">
          <span className="text-xs font-medium" id="news-imp">
            News that qualifies (importance ≥)
          </span>
          <Segmented
            size="sm"
            label="News importance"
            value={String(routine.newsMinImportance) as "1" | "2" | "3"}
            onChange={(v) => commit({ ...routine, newsMinImportance: Number(v) }, true)}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3 (high)" },
            ]}
          />
        </div>
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium">Alert before each block (min, 0 = off)</span>
          <Input
            type="number"
            min={0}
            max={60}
            value={routine.alertMinutes}
            onChange={(e) => commit({ ...routine, alertMinutes: Number(e.target.value || 0) })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void alerts.set(!alerts.on)}
            aria-pressed={!!alerts.on}
            data-testid="alerts-toggle"
          >
            {alerts.on ? "Alerts on (this device)" : "Turn on alerts on this device"}
          </Button>
          <span className="text-muted-foreground text-xs">
            A notice before each block while Consistent Grow is open in a tab. Allow notifications
            to get them when the tab is in the background.
          </span>
        </div>
      </section>

      <ol className="space-y-4">
        {routine.blocks.map((b, i) => (
          <li
            key={b.key}
            className="bg-card space-y-3 rounded-xl border p-4"
            data-testid="routine-block-editor"
            data-block={b.key}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={b.enabled}
                aria-label={`${b.title} enabled`}
                onChange={(e) => setBlock(i, { enabled: e.target.checked }, true)}
              />
              <Input
                aria-label="Block title"
                className="h-9 max-w-xs font-semibold"
                value={b.title}
                onChange={(e) => setBlock(i, { title: e.target.value })}
              />
              <span className="num text-muted-foreground text-xs" data-testid="lisbon-preview">
                {preview.get(b.key) ? `${preview.get(b.key)} Lisbon` : ""}
              </span>
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${b.title} up`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${b.title} down`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${b.title}`}
                  onClick={() => removeBlock(i)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <label className="grid gap-1 text-xs">
                Kind
                <NativeSelect
                  value={b.kind}
                  onChange={(e) =>
                    setBlock(i, { kind: e.target.value as RoutineBlock["kind"] }, true)
                  }
                >
                  <option value="prep">Prep</option>
                  <option value="trade">Trade</option>
                  <option value="debrief">Debrief</option>
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-xs">
                Session
                <NativeSelect
                  value={b.session}
                  onChange={(e) => setBlock(i, { session: e.target.value as "EU" | "US" }, true)}
                >
                  <option value="EU">EU</option>
                  <option value="US">US</option>
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-xs">
                Start
                <Input
                  type="time"
                  value={b.start}
                  aria-label={`${b.title} start`}
                  onChange={(e) => setBlock(i, { start: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs">
                End
                <Input
                  type="time"
                  value={b.end}
                  aria-label={`${b.title} end`}
                  onChange={(e) => setBlock(i, { end: e.target.value })}
                />
              </label>
              <label className="col-span-2 grid gap-1 text-xs">
                Time zone of these times
                <NativeSelect
                  value={b.tz}
                  onChange={(e) => setBlock(i, { tz: e.target.value as RoutineBlock["tz"] }, true)}
                >
                  {TZ_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>

            {b.kind === "trade" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-2 grid gap-1 text-xs">
                  Setup
                  <NativeSelect
                    value={b.playbookId ?? ""}
                    onChange={(e) => setBlock(i, { playbookId: e.target.value || null }, true)}
                  >
                    <option value="">— none —</option>
                    {setups.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-xs">
                  Max trades
                  <Input
                    inputMode="numeric"
                    placeholder="no limit"
                    value={b.maxTrades ?? ""}
                    aria-label={`${b.title} max trades`}
                    onChange={(e) => setBlock(i, { maxTrades: num(e.target.value) })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Max loss ($)
                  <Input
                    inputMode="decimal"
                    placeholder="no limit"
                    value={b.maxLossUsd ?? ""}
                    aria-label={`${b.title} max loss`}
                    onChange={(e) => setBlock(i, { maxLossUsd: num(e.target.value) })}
                  />
                </label>
                <label className="col-span-2 grid gap-1 text-xs">
                  Gate before trading
                  <NativeSelect
                    value={b.gate}
                    onChange={(e) =>
                      setBlock(i, { gate: e.target.value as RoutineBlock["gate"] }, true)
                    }
                  >
                    <option value="none">None</option>
                    <option value="news">News: only with a qualifying event</option>
                    <option value="bias">Bias: 3-tap check (winning side, trend, 1h)</option>
                  </NativeSelect>
                </label>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium">Steps</p>
              {b.steps.length === 0 && <p className="text-muted-foreground text-xs">No steps.</p>}
              <ul className="space-y-2">
                {b.steps.map((s, k) => {
                  const setStep = (patch: Partial<RoutineStep>, immediate = false) =>
                    setBlock(
                      i,
                      { steps: b.steps.map((x, m) => (m === k ? { ...x, ...patch } : x)) },
                      immediate,
                    );
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <NativeSelect
                        aria-label="Step kind"
                        className="h-9 w-40"
                        value={s.kind}
                        onChange={(e) => setStep({ kind: e.target.value as StepKind }, true)}
                      >
                        {STEP_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {STEP_LABEL[kind]}
                          </option>
                        ))}
                      </NativeSelect>
                      <Input
                        aria-label="Step label"
                        className="h-9 min-w-48 flex-1"
                        value={s.label}
                        onChange={(e) => setStep({ label: e.target.value })}
                      />
                      {s.kind === "link" && (
                        <Input
                          aria-label="Step link"
                          className="h-9 min-w-48 flex-1"
                          placeholder="https://…"
                          value={s.url ?? ""}
                          onChange={(e) => setStep({ url: e.target.value })}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove step ${s.label}`}
                        onClick={() =>
                          setBlock(i, { steps: b.steps.filter((_, m) => m !== k) }, true)
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setBlock(
                    i,
                    {
                      steps: [...b.steps, { id: uid("step"), kind: "check", label: "New step" }],
                    },
                    true,
                  )
                }
              >
                <Plus aria-hidden />
                Add step
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <Button variant="outline" onClick={addBlock}>
        <Plus aria-hidden />
        Add block
      </Button>
    </div>
  );
}

type StepKind = RoutineStep["kind"];
