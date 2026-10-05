"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  NotebookPen,
  PauseCircle,
  Plus,
} from "lucide-react";

import { SaveStatus } from "@/components/trade/save-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { QuickPrep, RoutineDayRow } from "@/lib/data/routine";
import { fmtMoney, pnlClass } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { useSaveQueue } from "@/lib/hooks/use-save-queue";
import type { RoutineStep } from "@/lib/routine/routine";
import {
  blockStatuses,
  blockUsage,
  dayStopped,
  focusBlock,
  qualifyingEvents,
  type BlockInstance,
  type BlockStatus,
  type GateEvent,
  type GuardTrade,
} from "@/lib/routine/schedule";
import { scalpBias, type ScalpCheck } from "@/lib/routine/bias";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

import { QuickPrepForm, type PrepInstrument } from "./quick-prep";

type Session = "EU" | "US";

export type TimelineProps = {
  date: string;
  /** The routine of a later trading day (today is closed). */
  upcoming?: boolean;
  nowIso: string;
  blocks: BlockInstance[];
  days: Record<string, RoutineDayRow>;
  trades: GuardTrade[];
  dayMaxLossUsd: number | null;
  newsMinImportance: number;
  events: (GateEvent & { instruments: string[] })[];
  instruments: PrepInstrument[];
  quickPreps: Partial<Record<Session, QuickPrep>>;
  /** Server-rendered Pre-Open cards, one per edition. */
  briefs: Partial<Record<Session, ReactNode>>;
  /** One-line narrative suggestion from each edition's TL;DR. */
  suggestions: Partial<Record<Session, string>>;
  setups: Record<string, string>;
  debriefDone: boolean;
};

const hhmm = (iso: string) => formatInTz(iso, DISPLAY_TZ, "HH:mm");

function until(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  if (m >= 24 * 60) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

const EMPTY_ROW: RoutineDayRow = {
  checks: {},
  bias: {},
  noTrade: false,
  followed: null,
  lesson: null,
};

/**
 * Today as one timeline of the routine's blocks: the running (or next) block
 * open with its steps, gate, guardrails and one-tap logging; the rest folded.
 */
export function RoutineTimeline(props: TimelineProps) {
  const { date, blocks } = props;
  const tick = useNow(30_000);
  const now = useMemo(() => new Date(tick ?? Date.parse(props.nowIso)), [tick, props.nowIso]);
  const statuses = blockStatuses(blocks, now);
  const focus = focusBlock(blocks, now);
  const { status, save, retry } = useSaveQueue();
  const [days, setDays] = useState(props.days);
  const [preps, setPreps] = useState(props.quickPreps);
  const stoppedForDay = dayStopped({ dayMaxLossUsd: props.dayMaxLossUsd }, props.trades);

  function patch(block: string, p: Partial<RoutineDayRow>) {
    setDays((all) => {
      const cur = all[block] ?? EMPTY_ROW;
      return {
        ...all,
        [block]: {
          ...cur,
          ...p,
          checks: { ...cur.checks, ...(p.checks ?? {}) },
          bias: { ...cur.bias, ...(p.bias ?? {}) },
        },
      };
    });
    const body: Record<string, Json> = {};
    if (p.checks) body.checks = p.checks;
    if (p.bias) body.bias = p.bias as Record<string, Json>;
    if (p.noTrade !== undefined) body.no_trade = p.noTrade;
    // Each field saves under its own key so quick taps never overwrite each other.
    for (const [k, v] of Object.entries(body)) {
      const sub = v && typeof v === "object" ? Object.keys(v as object).join(",") : "";
      save(
        `day:${block}:${k}:${sub}`,
        () =>
          createClient().rpc("save_routine_day", {
            p_date: date,
            p_block: block,
            p_patch: { [k]: v },
          }),
        true,
      );
    }
  }

  if (blocks.length === 0) return null;

  return (
    <section aria-label="Today's routine" className="space-y-2" data-testid="routine">
      <div className="flex items-center gap-2">
        <h2 className="heading-caps text-xs">
          {props.upcoming
            ? `Routine · ${formatInTz(`${date}T12:00:00Z`, "UTC", "EEEE d MMM")}`
            : "Routine"}
        </h2>
        <span className="text-muted-foreground text-xs">Lisbon time</span>
        <div className="ml-auto">
          {status !== "idle" && <SaveStatus status={status} onRetry={retry} />}
        </div>
      </div>
      {stoppedForDay && (
        <div
          className="bg-muted/60 flex items-center gap-2 rounded-xl border p-4 text-sm"
          data-testid="day-stopped"
        >
          <PauseCircle className="text-muted-foreground size-5" aria-hidden />
          Daily loss limit reached — you&apos;re done for today. Debrief and come back fresh.
        </div>
      )}
      <ol className="space-y-2">
        {blocks.map((b) => (
          <BlockCard
            key={b.key}
            block={b}
            status={statuses.get(b.key) ?? "later"}
            isFocus={focus?.key === b.key}
            now={now}
            row={days[b.key] ?? EMPTY_ROW}
            onPatch={(p) => patch(b.key, p)}
            props={props}
            prep={preps[b.session]}
            onPrep={(q) => setPreps((all) => ({ ...all, [b.session]: q }))}
            save={save}
            stoppedForDay={stoppedForDay}
          />
        ))}
      </ol>
    </section>
  );
}

function blockDone(
  b: BlockInstance,
  row: RoutineDayRow,
  prep: QuickPrep | undefined,
  debriefDone: boolean,
): boolean {
  if (b.kind === "debrief") return debriefDone;
  if (b.kind === "prep") return b.steps.length > 0 && b.steps.every((s) => stepDone(s, row, prep));
  return row.noTrade || (b.steps.length > 0 && b.steps.every((s) => stepDone(s, row, prep)));
}

function stepDone(s: RoutineStep, row: RoutineDayRow, prep: QuickPrep | undefined) {
  if (s.kind === "prep") return row.checks[s.id] === true || !!prep?.narrative.trim();
  return row.checks[s.id] === true;
}

function BlockCard({
  block: b,
  status,
  isFocus,
  now,
  row,
  onPatch,
  props,
  prep,
  onPrep,
  save,
  stoppedForDay,
}: {
  block: BlockInstance;
  status: BlockStatus;
  isFocus: boolean;
  now: Date;
  row: RoutineDayRow;
  onPatch: (p: Partial<RoutineDayRow>) => void;
  props: TimelineProps;
  prep: QuickPrep | undefined;
  onPrep: (q: QuickPrep) => void;
  save: ReturnType<typeof useSaveQueue>["save"];
  stoppedForDay: boolean;
}) {
  const done = blockDone(b, row, prep, props.debriefDone);
  const usage = b.kind === "trade" ? blockUsage(b, props.trades) : null;
  const ms =
    status === "now"
      ? Date.parse(b.endAt) - now.getTime()
      : status === "next" || status === "later"
        ? Date.parse(b.startAt) - now.getTime()
        : 0;

  return (
    <li>
      <details
        open={isFocus}
        className={cn(
          "group bg-card rounded-xl border",
          status === "now" && "border-primary/60",
          status === "past" && "opacity-90",
        )}
        data-testid="routine-block"
        data-block={b.key}
        data-status={status}
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          {done ? (
            <CheckCircle2 className="text-profit size-5 shrink-0" aria-label="Done" />
          ) : (
            <Circle
              className={cn(
                "size-5 shrink-0",
                status === "now" ? "text-primary-ink" : "text-muted-foreground",
              )}
              aria-hidden
            />
          )}
          <span className="num text-muted-foreground w-24 shrink-0 text-xs">
            {hhmm(b.startAt)}–{hhmm(b.endAt)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.title}</span>
          {status === "now" && (
            <Badge variant="accent" data-testid="block-now">
              Now · {until(ms)} left
            </Badge>
          )}
          {status === "next" && <Badge variant="outline">Next · in {until(ms)}</Badge>}
          {usage && usage.trades > 0 && (
            <span className={cn("num text-xs", pnlClass(usage.net))}>
              {usage.trades}× {fmtMoney(usage.net)}
            </span>
          )}
          {b.clipped && <Badge variant="warn">early close</Badge>}
        </summary>
        <div className="space-y-4 border-t px-4 py-4">
          {b.steps.length > 0 && (
            <ul className="space-y-3">
              {b.steps.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  block={b}
                  row={row}
                  prep={prep}
                  onPatch={onPatch}
                  props={props}
                  onPrep={onPrep}
                  save={save}
                />
              ))}
            </ul>
          )}
          {b.kind === "trade" && (
            <TradeBlockBody
              block={b}
              row={row}
              onPatch={onPatch}
              props={props}
              prep={prep}
              usage={usage!}
              stoppedForDay={stoppedForDay}
            />
          )}
          {b.kind === "debrief" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted-foreground flex-1 text-sm">
                {props.debriefDone
                  ? "Debrief done. Everything stays editable."
                  : "Per block: did you follow the plan? One line each, then grade the day."}
              </p>
              <Button asChild variant={props.debriefDone ? "outline" : "default"}>
                <Link href={`/review/${props.date}`}>
                  <NotebookPen aria-hidden />
                  {props.debriefDone ? "Open debrief" : "2-minute debrief"}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function CheckBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-[3px]",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {checked && <Check className="size-4" aria-hidden />}
    </button>
  );
}

function StepRow({
  step: s,
  block: b,
  row,
  prep,
  onPatch,
  props,
  onPrep,
  save,
}: {
  step: RoutineStep;
  block: BlockInstance;
  row: RoutineDayRow;
  prep: QuickPrep | undefined;
  onPatch: (p: Partial<RoutineDayRow>) => void;
  props: TimelineProps;
  onPrep: (q: QuickPrep) => void;
  save: ReturnType<typeof useSaveQueue>["save"];
}) {
  const done = stepDone(s, row, prep);
  const set = (v: boolean) => onPatch({ checks: { [s.id]: v } });
  const session = b.session;
  const chosen = (prep?.instrumentIds ?? [])
    .map((id) => props.instruments.find((i) => i.id === id)?.symbol)
    .filter(Boolean);

  return (
    <li className="space-y-2" data-testid="routine-step" data-step={s.id}>
      <div className="flex items-start gap-3">
        <CheckBox checked={done} onChange={set} label={s.label} />
        <div className="min-w-0 flex-1 pt-0.5 text-sm">
          {s.kind === "link" && s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-ink inline-flex items-center gap-1 hover:underline"
              onClick={() => !done && set(true)}
            >
              {s.label}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : (
            <span className={cn(done && "text-muted-foreground")}>{s.label}</span>
          )}
          {s.kind === "charts" && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {chosen.length > 0
                ? `On the 1h chart: ${chosen.join(", ")}`
                : "Pick the narrative's instruments in the prep below."}
            </p>
          )}
        </div>
      </div>
      {s.kind === "brief" &&
        (props.briefs[session] ?? (
          <p className="text-muted-foreground pl-9 text-xs">
            The {session} Pre-Open hasn&apos;t arrived yet.
          </p>
        ))}
      {s.kind === "prep" && (
        <div className="pl-9">
          <QuickPrepForm
            date={props.date}
            session={session}
            initial={prep}
            suggestion={props.suggestions[session] ?? ""}
            instruments={props.instruments}
            onChange={onPrep}
            save={save}
          />
        </div>
      )}
    </li>
  );
}

const SIDE_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "unclear", label: "Unclear" },
] as const;
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

function TradeBlockBody({
  block: b,
  row,
  onPatch,
  props,
  prep,
  usage,
  stoppedForDay,
}: {
  block: BlockInstance;
  row: RoutineDayRow;
  onPatch: (p: Partial<RoutineDayRow>) => void;
  props: TimelineProps;
  prep: QuickPrep | undefined;
  usage: ReturnType<typeof blockUsage>;
  stoppedForDay: boolean;
}) {
  const events =
    b.gate === "news" ? qualifyingEvents(b, props.events, props.newsMinImportance) : [];
  const check = row.bias as ScalpCheck;
  const bias = b.gate === "bias" ? scalpBias(check) : null;
  const firstInst = prep?.instrumentIds[0];
  const prepBias = firstInst ? prep?.bias[firstInst] : undefined;
  const direction =
    bias?.side ?? (prepBias === "long" || prepBias === "short" ? prepBias : undefined);
  const q = new URLSearchParams();
  if (b.playbookId) q.set("playbook", b.playbookId);
  if (firstInst) q.set("instrument", firstInst);
  if (direction) q.set("direction", direction);
  const blocked = b.gate === "news" && (row.noTrade || events.length === 0);
  const stopped = usage.stopped || stoppedForDay;

  return (
    <div className="space-y-4">
      {b.gate === "news" && (
        <div className="space-y-2" data-testid="news-gate">
          <h3 className="text-xs font-semibold">Qualifying events</h3>
          {events.length > 0 ? (
            <ul className="divide-y rounded-lg border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="num text-muted-foreground text-xs">{hhmm(e.startsAt)}</span>
                  <span className="flex-1">{e.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              No high-impact event in this window. <strong>No event, no EU trade.</strong>
            </p>
          )}
          {row.noTrade ? (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="no-trade-confirmed"
            >
              <CheckCircle2 className="text-profit size-4" aria-hidden />
              No EU trades today — confirmed.
              <Button variant="link" size="sm" onClick={() => onPatch({ noTrade: false })}>
                Undo
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onPatch({ noTrade: true })}>
              Confirm: no EU trades today
            </Button>
          )}
        </div>
      )}

      {b.gate === "bias" && (
        <div className="space-y-3" data-testid="bias-check">
          <h3 className="text-xs font-semibold">Before the block: 3 taps</h3>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              Winning side so far (price vs VWAP and the day&apos;s open)
            </p>
            <Segmented
              label="Winning side so far"
              value={check.side ?? null}
              onChange={(v) => onPatch({ bias: { side: v } })}
              options={[...SIDE_OPTIONS]}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                Trend day? (1st-hour range broken and held)
              </p>
              <Segmented
                label="Trend day"
                value={check.trend ?? null}
                onChange={(v) => onPatch({ bias: { trend: v } })}
                options={[...YES_NO]}
              />
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Higher timeframe (1h) agrees?</p>
              <Segmented
                label="Higher timeframe agrees"
                value={check.htf ?? null}
                onChange={(v) => onPatch({ bias: { htf: v } })}
                options={[...YES_NO]}
              />
            </div>
          </div>
          {bias && (
            <p
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                bias.side ? "border-primary/50 bg-primary/5" : "bg-muted/50",
              )}
              data-testid="bias-result"
            >
              {bias.text}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-testid="guardrails">
        <span>
          Trades <span className="num font-semibold">{usage.trades}</span>
          {b.maxTrades !== null && <span className="num"> / {b.maxTrades}</span>}
        </span>
        <span>
          Net{" "}
          <span className={cn("num font-semibold", pnlClass(usage.net))}>
            {fmtMoney(usage.net)}
          </span>
        </span>
        {usage.lossLeft !== null && (
          <span>
            Loss left <span className="num font-semibold">{fmtMoney(usage.lossLeft)}</span>
          </span>
        )}
        {b.playbookId && props.setups[b.playbookId] && (
          <Link
            href={`/playbook/${b.playbookId}`}
            className="text-primary-ink ml-auto hover:underline"
          >
            Setup: {props.setups[b.playbookId]} →
          </Link>
        )}
      </div>

      {stopped ? (
        <div
          className="bg-muted/60 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
          data-testid="block-stopped"
        >
          <PauseCircle className="text-muted-foreground size-5" aria-hidden />
          <span className="flex-1">
            Done for this block —{" "}
            {stoppedForDay
              ? "daily loss limit reached."
              : usage.reason === "trades"
                ? "trade limit reached."
                : "loss limit reached."}{" "}
            Stand aside until the next one.
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/journal/new?${q}`}>Log a trade anyway</Link>
          </Button>
        </div>
      ) : (
        <Button
          asChild
          size="lg"
          variant={blocked ? "outline" : "default"}
          className="h-12 w-full sm:w-auto"
        >
          <Link href={`/journal/new?${q}`} data-testid="block-log">
            <Plus aria-hidden />
            Log {props.setups[b.playbookId ?? ""] ?? "trade"}
          </Link>
        </Button>
      )}
    </div>
  );
}
