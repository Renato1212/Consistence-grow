"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Copy, Plus, Zap } from "lucide-react";
import { toast } from "sonner";

import { EventSheet } from "@/components/calendar/event-sheet";
import { QuickAddDialog } from "@/components/calendar/quick-add";
import { ChipMulti, Field } from "@/components/form/field";
import { SaveStatus } from "@/components/trade/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { AutosaveController, browserStore, type AutosaveStatus } from "@/lib/autosave/controller";
import { addDays, isWeekend } from "@/lib/calendar/dates";
import { HolidayCalendar } from "@/lib/calendar/holidays";
import type { CalendarEvent } from "@/lib/calendar/types";
import { logClientError } from "@/lib/client-errors";
import type { PrepPageData } from "@/lib/data/prep";
import { domainMeta } from "@/lib/domains";
import {
  PRIOR_DAY_TYPES,
  REGIMES,
  carryForward,
  copyFromPrep,
  emptyPrep,
  hasContent,
  isReady,
  sortLevels,
  toPrepPayload,
  type PrepSnapshot,
} from "@/lib/prep/prep-form";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionItemsList } from "@/components/review/action-items-list";
import { DayEvents } from "./day-events";
import { LevelsEditor } from "./levels-editor";
import { Markdown } from "./markdown";
import { ScenariosEditor } from "./scenarios-editor";
import { Section } from "./section";

const SCORE = ["1", "2", "3", "4", "5"] as const;

function nextWeekday(date: string, dir: 1 | -1) {
  let d = addDays(date, dir);
  while (isWeekend(d)) d = addDays(d, dir);
  return d;
}

export function PrepEditor({ data }: { data: PrepPageData }) {
  const router = useRouter();
  const { date, session, instruments, playbooks, rules } = data;
  const storageKey = `cg:prep:${date}:${session}`;
  const cal = useMemo(() => new HolidayCalendar(data.holidays), [data.holidays]);

  // Server copy, unless this device holds newer unsaved changes (crash, offline).
  const [start] = useState(() => {
    const server = data.current?.snapshot ?? null;
    const raw = browserStore.get(storageKey);
    if (raw) {
      try {
        const rec = JSON.parse(raw) as { snapshot: PrepSnapshot; at: number };
        const newer = !data.current || rec.at > Date.parse(data.current.updatedAt);
        if (rec.snapshot?.date === date && rec.snapshot.session === session && newer) {
          return {
            snap: { ...rec.snapshot, id: server?.id ?? rec.snapshot.id },
            recovered: true,
          };
        }
      } catch {
        /* corrupt local copy: ignore */
      }
      browserStore.remove(storageKey);
    }
    return {
      snap: server
        ? { ...server, levels: sortLevels(server.levels) }
        : emptyPrep(data.newId, date, session),
      recovered: false,
    };
  });
  const [snap, setSnap] = useState<PrepSnapshot>(start.snap);
  const [status, setStatus] = useState<AutosaveStatus>(data.current ? "saved" : "idle");

  const [controller] = useState(() => {
    const supabase = createClient();
    return new AutosaveController<PrepSnapshot>({
      storageKey,
      store: browserStore,
      save: async (s) => {
        const { payload } = toPrepPayload(s, instruments);
        const { error } = await supabase.rpc("save_prep", { p: payload as Json });
        if (error) throw error;
      },
      onStatus: (st, err) => {
        setStatus(st);
        if (st === "error") logClientError("prep.autosave", err, { date, session });
      },
    });
  });

  const change = (patch: Partial<PrepSnapshot> | ((s: PrepSnapshot) => PrepSnapshot)) => {
    const next = typeof patch === "function" ? patch(snap) : { ...snap, ...patch };
    setSnap(next);
    controller.update(next);
  };

  useEffect(() => {
    if (start.recovered) {
      controller.update(start.snap);
      toast.info("Restored unsaved prep changes from this device");
    }
  }, [start, controller]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved()) e.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") void controller.flush();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      void controller.flush();
      controller.dispose();
    };
  }, [controller]);

  const { issues } = useMemo(() => toPrepPayload(snap, instruments), [snap, instruments]);
  const issueMap = useMemo(() => new Map(issues.map((i) => [i.id, i.message])), [issues]);

  const [sheet, setSheet] = useState<{ event: CalendarEvent | null; n: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);

  const activeSymbols = instruments.filter((i) => i.active).map((i) => i.symbol);
  const defaultInstrumentId =
    snap.focusInstrumentIds[0] ?? instruments.find((i) => i.active)?.id ?? "";

  const previous = data.previous;
  const carry = previous
    ? {
        date: previous.date,
        count: carryForward(snap.levels, previous.levels, previous.tested, () => "").length,
        run: () => {
          const add = carryForward(snap.levels, previous.levels, previous.tested, () =>
            crypto.randomUUID(),
          );
          change({ levels: [...snap.levels, ...add] });
          toast.success(`Carried forward ${add.length} level${add.length === 1 ? "" : "s"}`);
        },
      }
    : null;

  async function complete() {
    if (!isReady(snap)) {
      toast.error("Fill the readiness check first (sleep, energy, focus).");
      document.getElementById("readiness")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    change({ completedAt: new Date().toISOString() });
    await controller.flush();
    if (controller.getStatus() === "error") toast.error("Not saved yet — retry.");
    else toast.success(`${session} prep complete`);
  }

  function copyEu() {
    if (!data.eu) return;
    if (
      hasContent(snap) &&
      !window.confirm(
        "Copy the EU prep into this one? Levels and scenarios are added; context, focus and risk plan are replaced.",
      )
    ) {
      return;
    }
    change(copyFromPrep(snap, data.eu, () => crypto.randomUUID()));
    toast.success("Copied from EU prep — edit what changed");
  }

  const otherSession = session === "EU" ? "US" : "EU";

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div className="bg-background/95 sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-2 border-b px-4 py-2 backdrop-blur">
        <h1 className="heading-caps text-base">{session} prep</h1>
        <span className="text-muted-foreground text-sm">
          {formatInTz(`${date}T12:00:00Z`, "UTC", "EEE d MMM")}
        </span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/prep/${nextWeekday(date, -1)}/${session.toLowerCase()}`}
              aria-label="Previous day"
            >
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/prep/${nextWeekday(date, 1)}/${session.toLowerCase()}`}
              aria-label="Next day"
            >
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/prep/${date}/${otherSession.toLowerCase()}`}>{otherSession} prep</Link>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus status={status} onRetry={() => void controller.retry()} />
          {snap.completedAt ? (
            <span
              className="text-primary inline-flex items-center gap-1 text-xs font-semibold"
              data-testid="prep-complete"
            >
              <CheckCircle2 className="size-4" aria-hidden />
              Complete {formatInTz(snap.completedAt, DISPLAY_TZ, "HH:mm")}
            </span>
          ) : (
            <Button size="sm" onClick={complete}>
              Prep complete
            </Button>
          )}
        </div>
      </div>

      <ActionItemsList items={data.actionItems} title="From past debriefs" />

      {session === "US" && data.eu && snap.copiedFromId !== data.eu.id && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
          <p className="text-sm">
            An EU prep exists for today. Copy it forward and edit only what changed.
          </p>
          <Button variant="outline" size="sm" onClick={copyEu} className="ml-auto">
            <Copy aria-hidden />
            Copy from EU prep
          </Button>
        </div>
      )}

      <Section id="readiness" title="Readiness" required>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["sleep", "energy", "focus"] as const).map((k) => (
            <Field key={k} id={`ready-${k}`} label={k[0].toUpperCase() + k.slice(1)}>
              <Segmented
                label={k}
                size="sm"
                value={snap[k] === null ? null : String(snap[k])}
                onChange={(v) => change({ [k]: Number(v) })}
                options={SCORE.map((s) => ({ value: s, label: s }))}
              />
            </Field>
          ))}
        </div>
        <Field id="how-am-i" label="How am I?">
          <Input
            id="how-am-i"
            value={snap.howAmI}
            onChange={(e) => change({ howAmI: e.target.value })}
            placeholder="One line"
          />
        </Field>
      </Section>

      <BriefSection value={snap.briefMd} onChange={(briefMd) => change({ briefMd })} />

      <Section id="context" title="Environment / context">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="prior-day" label="Prior day / session type">
            <Input
              id="prior-day"
              list="prior-day-types"
              value={snap.priorDayType}
              onChange={(e) => change({ priorDayType: e.target.value })}
            />
            <datalist id="prior-day-types">
              {PRIOR_DAY_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field id="regime" label="Market regime">
            <Input
              id="regime"
              list="regimes"
              value={snap.regime}
              onChange={(e) => change({ regime: e.target.value })}
            />
            <datalist id="regimes">
              {REGIMES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field id="vol" label="Volume & volatility vs normal">
          <Segmented
            label="Volume and volatility"
            size="sm"
            value={snap.volState || null}
            onChange={(v) => change({ volState: v })}
            options={[
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
            ]}
          />
        </Field>
        <Field id="narrative" label="Narrative — what is the market focused on?">
          <Textarea
            id="narrative"
            rows={2}
            value={snap.narrative}
            onChange={(e) => change({ narrative: e.target.value })}
          />
        </Field>
        <Field id="options-notes" label="Options / positioning notes">
          <Textarea
            id="options-notes"
            rows={2}
            value={snap.optionsNotes}
            onChange={(e) => change({ optionsNotes: e.target.value })}
          />
        </Field>
      </Section>

      <Section
        id="calendar"
        title="Today's calendar"
        aside={
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setQuickAdd(true)}>
              <Zap aria-hidden />
              Preset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSheet((s) => ({ event: null, n: (s?.n ?? 0) + 1 }))}
            >
              <Plus aria-hidden />
              Event
            </Button>
          </div>
        }
      >
        <DayEvents
          date={date}
          events={data.events}
          cal={cal}
          onOpen={(event) => setSheet((s) => ({ event, n: (s?.n ?? 0) + 1 }))}
        />
      </Section>

      <Section id="levels" title="Key levels">
        <LevelsEditor
          levels={snap.levels}
          onChange={(levels) => change({ levels })}
          instruments={instruments}
          defaultInstrumentId={defaultInstrumentId}
          issues={issueMap}
          carry={carry}
        />
      </Section>

      <Section id="scenarios" title="Scenarios (if → then)">
        <ScenariosEditor
          scenarios={snap.scenarios}
          onChange={(scenarios) => change({ scenarios })}
          instruments={instruments}
          playbooks={playbooks}
          defaultInstrumentId={defaultInstrumentId}
        />
      </Section>

      <Section id="focus" title="Focus">
        <Field id="focus-instruments" label="Focus instruments (max 3 suggested)">
          <ChipMulti
            label="Focus instruments"
            value={snap.focusInstrumentIds}
            onChange={(focusInstrumentIds) => change({ focusInstrumentIds })}
            options={instruments
              .filter((i) => i.active || snap.focusInstrumentIds.includes(i.id))
              .map((i) => ({ value: i.id, label: i.symbol }))}
          />
          {snap.focusInstrumentIds.length > 3 && (
            <p className="text-xs text-amber-500">
              {snap.focusInstrumentIds.length} instruments — fewer is usually better.
            </p>
          )}
        </Field>
        <Field id="focus-playbooks" label="Playbooks for today">
          {playbooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No playbooks yet.</p>
          ) : (
            <ChipMulti
              label="Playbooks for today"
              value={snap.focusPlaybookIds}
              onChange={(focusPlaybookIds) => change({ focusPlaybookIds })}
              options={playbooks.map((p) => ({
                value: p.id,
                label: p.name,
                dot: domainMeta(p.primaryDomain).bgClassName,
              }))}
            />
          )}
        </Field>
        <Field id="intention" label="Intention (one sentence)">
          <Input
            id="intention"
            value={snap.intention}
            onChange={(e) => change({ intention: e.target.value })}
          />
        </Field>
      </Section>

      <Section id="risk" title="Risk plan">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["maxLossUsd", "Max daily loss ($)"],
              ["maxLossR", "Max daily loss (R)"],
              ["maxTrades", "Max trades"],
              ["maxSize", "Max size / trade"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} id={`risk-${k}`} label={label}>
              <Input
                id={`risk-${k}`}
                inputMode="decimal"
                className="num"
                value={snap[k]}
                onChange={(e) => change({ [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Shown as a live gauge on Today during the session.
        </p>
      </Section>

      <Section id="rules" title="Rules check">
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active rules.</p>
        ) : (
          <ul className="space-y-2" data-testid="prep-rules">
            {rules.map((r) => (
              <li key={r.id}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 size-4"
                    checked={snap.ruleChecks[r.id] ?? false}
                    onChange={(e) =>
                      change({ ruleChecks: { ...snap.ruleChecks, [r.id]: e.target.checked } })
                    }
                  />
                  <span className={cn(snap.ruleChecks[r.id] && "text-muted-foreground")}>
                    {r.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!snap.completedAt && (
        <div className="flex justify-end">
          <Button onClick={complete}>Prep complete</Button>
        </div>
      )}
      {snap.completedAt && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => change({ completedAt: null })}>
            Mark as not complete
          </Button>
        </div>
      )}

      {sheet && (
        <EventSheet
          key={sheet.n}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          event={sheet.event}
          defaultDate={date}
          symbols={activeSymbols}
          onChanged={() => router.refresh()}
        />
      )}
      {quickAdd && (
        <QuickAddDialog
          open
          onOpenChange={setQuickAdd}
          defaultDate={date}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function BriefSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"write" | "preview">(value ? "preview" : "write");
  return (
    <Section
      id="brief"
      title="Brief"
      aside={
        <Segmented
          label="Brief mode"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: "Paste" },
            { value: "preview", label: "Read" },
          ]}
        />
      }
    >
      {mode === "write" ? (
        <Textarea
          aria-label="Pre-session brief (markdown)"
          rows={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your pre-session brief (markdown supported)"
          className="font-mono text-xs"
        />
      ) : value.trim() ? (
        <div data-testid="brief-rendered">
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No brief pasted.</p>
      )}
    </Section>
  );
}
