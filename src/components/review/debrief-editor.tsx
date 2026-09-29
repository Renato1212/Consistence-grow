"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/form/field";
import { Section } from "@/components/prep/section";
import { MediaManager } from "@/components/trade/media-manager";
import { SaveStatus } from "@/components/trade/save-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { AutosaveController, browserStore, type AutosaveStatus } from "@/lib/autosave/controller";
import { addDays, isWeekend } from "@/lib/calendar/dates";
import { logClientError } from "@/lib/client-errors";
import type { DebriefPageData } from "@/lib/data/debrief";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import {
  GRADES,
  OUTCOME_LABEL,
  completionIssues,
  toDebriefPayload,
  type DebriefSnapshot,
  type Grade,
  type Outcome,
} from "@/lib/review/debrief-form";
import { summarize } from "@/lib/review/stats";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionItemsList } from "./action-items-list";

const SCORE = ["1", "2", "3", "4", "5"] as const;
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;
const yn = (v: boolean | null) => (v === null ? null : v ? "yes" : "no");

function shiftWeekday(date: string, dir: 1 | -1) {
  let d = addDays(date, dir);
  while (isWeekend(d)) d = addDays(d, dir);
  return d;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground heading-caps text-[10px]">{label}</div>
      <div className="num truncate text-sm font-semibold">{children}</div>
    </div>
  );
}

export function DebriefEditor({ data }: { data: DebriefPageData }) {
  const { date, trades, rules } = data;
  const storageKey = `cg:debrief:${date}`;

  const [start] = useState(() => {
    const raw = browserStore.get(storageKey);
    if (raw) {
      try {
        const rec = JSON.parse(raw) as { snapshot: DebriefSnapshot; at: number };
        const newer = !data.updatedAt || rec.at > Date.parse(data.updatedAt);
        if (rec.snapshot?.date === date && newer) {
          return {
            snap: { ...rec.snapshot, id: data.exists ? data.snapshot.id : rec.snapshot.id },
            recovered: true,
          };
        }
      } catch {
        /* corrupt local copy: ignore */
      }
      browserStore.remove(storageKey);
    }
    return { snap: data.snapshot, recovered: false };
  });
  const [snap, setSnap] = useState<DebriefSnapshot>(start.snap);
  const [status, setStatus] = useState<AutosaveStatus>(data.exists ? "saved" : "idle");
  const [persisted, setPersisted] = useState(data.exists);

  const [controller] = useState(() => {
    const supabase = createClient();
    return new AutosaveController<DebriefSnapshot>({
      storageKey,
      store: browserStore,
      save: async (s) => {
        const { error } = await supabase.rpc("save_debrief", {
          p: toDebriefPayload(s) as Json,
        });
        if (error) throw error;
      },
      onStatus: (st, err) => {
        setStatus(st);
        if (st === "error") logClientError("debrief.autosave", err, { date });
      },
      onSaved: () => setPersisted(true),
    });
  });

  const change = (patch: Partial<DebriefSnapshot>) => {
    const next = { ...snap, ...patch };
    setSnap(next);
    controller.update(next);
  };

  useEffect(() => {
    if (start.recovered) {
      controller.update(start.snap);
      toast.info("Restored unsaved debrief changes from this device");
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

  const stats = useMemo(() => summarize(trades), [trades]);
  const taken = trades.filter((t) => t.kind === "taken");
  const missed = trades.filter((t) => t.kind === "missed");
  const ruleText = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.text])), [rules]);
  const violations = Object.values(snap.rules).filter((r) => r.followed === false).length;

  async function complete() {
    const issues = completionIssues(snap, ruleText);
    if (issues.length) {
      toast.error(`To complete, add: ${issues.join(", ")}`);
      return;
    }
    change({ completedAt: new Date().toISOString() });
    await controller.flush();
    if (controller.getStatus() === "error") toast.error("Not saved yet — retry.");
    else toast.success("Debrief complete");
  }

  const setBullet = (key: "wentWell" | "toImprove", i: number, v: string) => {
    const list = [...snap[key]];
    list[i] = v;
    change({ [key]: list });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div className="bg-background/95 sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-2 border-b px-4 py-2 backdrop-blur">
        <h1 className="heading-caps text-base">Debrief</h1>
        <span className="text-muted-foreground text-sm">
          {formatInTz(`${date}T12:00:00Z`, "UTC", "EEE d MMM")}
        </span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/review/${shiftWeekday(date, -1)}`} aria-label="Previous day">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/review/${shiftWeekday(date, 1)}`} aria-label="Next day">
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus status={status} onRetry={() => void controller.retry()} />
          {snap.completedAt ? (
            <span
              className="text-primary-ink inline-flex items-center gap-1 text-xs font-semibold"
              data-testid="debrief-complete"
            >
              <CheckCircle2 className="size-4" aria-hidden />
              Complete {formatInTz(snap.completedAt, DISPLAY_TZ, "HH:mm")}
            </span>
          ) : (
            <Button size="sm" onClick={complete}>
              Debrief complete
            </Button>
          )}
        </div>
      </div>

      <Section id="day" title="The day">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6" data-testid="day-stats">
          <Stat label="Trades">{stats.n}</Stat>
          <Stat label="Win rate">
            {stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)}%`}
          </Stat>
          <Stat label={`Net R (n=${stats.rN})`}>
            <span className={pnlClass(stats.netR)}>{stats.rN ? fmtR(stats.netR) : "—"}</span>
          </Stat>
          <Stat label="Net">
            {Object.keys(stats.byCurrency).length === 0
              ? "—"
              : Object.entries(stats.byCurrency).map(([cur, v]) => (
                  <span key={cur} className={cn("mr-2", pnlClass(v))}>
                    {fmtMoney(v, cur)}
                  </span>
                ))}
          </Stat>
          <Stat label="Best / worst">
            {stats.best ? `${fmtR(stats.best.r_multiple)} / ${fmtR(stats.worst?.r_multiple)}` : "—"}
          </Stat>
          <Stat label="Rules broken">{violations}</Stat>
        </div>
        {taken.length > 0 ? (
          <ul className="divide-y rounded-lg border text-sm">
            {taken.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/journal?trade=${t.id}`}
                  className="hover:bg-muted/50 flex items-center gap-3 px-3 py-2"
                >
                  <span className="num text-muted-foreground w-12 text-xs">
                    {formatInTz(t.entry_at, DISPLAY_TZ, "HH:mm")}
                  </span>
                  <span className="flex-1 font-semibold">
                    {t.symbol} {t.direction}
                  </span>
                  {t.grade_process && (
                    <Badge variant="outline" className="text-[10px]">
                      Process {t.grade_process}
                    </Badge>
                  )}
                  <span className={cn("num w-16 text-right", pnlClass(t.r_multiple))}>
                    {fmtR(t.r_multiple)}
                  </span>
                  <span className={cn("num w-24 text-right text-xs", pnlClass(t.net_pnl))}>
                    {fmtMoney(t.net_pnl, t.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No trades logged for this day.</p>
        )}
        {missed.length > 0 && (
          <div className="space-y-1">
            <h3 className="heading-caps text-muted-foreground text-[10px]">Missed trades</h3>
            <ul className="text-sm">
              {missed.map((t) => (
                <li key={t.id}>
                  <Link href={`/journal?trade=${t.id}`} className="hover:underline">
                    {formatInTz(t.entry_at, DISPLAY_TZ, "HH:mm")} {t.symbol} {t.direction} ·{" "}
                    <span className="text-muted-foreground">
                      left {fmtMoney(t.net_pnl, t.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="plan" title="Plan vs reality">
        {data.scenarios.length === 0 ? (
          <p className="text-muted-foreground text-sm">No scenarios were prepared for this day.</p>
        ) : (
          <ul className="space-y-3" data-testid="debrief-scenarios">
            {data.scenarios.map((s) => {
              const v = snap.scenarios[s.id] ?? { outcome: null, traded: null };
              const set = (p: Partial<typeof v>) =>
                change({ scenarios: { ...snap.scenarios, [s.id]: { ...v, ...p } } });
              return (
                <li
                  key={s.id}
                  className="bg-background space-y-2 rounded-md border p-3"
                  data-testid="debrief-scenario"
                >
                  <p className="text-sm">
                    <span className="text-muted-foreground mr-1 text-xs">
                      {[s.session, s.symbol, s.direction].filter(Boolean).join(" · ")}
                    </span>
                    <span className="font-semibold">If</span> {s.ifText}{" "}
                    <span className="font-semibold">→ then</span> {s.thenText}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Segmented
                      label="Outcome"
                      size="sm"
                      value={v.outcome}
                      onChange={(outcome) => set({ outcome: outcome as Outcome })}
                      options={(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => ({
                        value: o,
                        label: OUTCOME_LABEL[o],
                      }))}
                    />
                    <span className="text-muted-foreground text-xs">Did I trade it?</span>
                    <Segmented
                      label="Did I trade it?"
                      size="sm"
                      value={yn(v.traded)}
                      onChange={(x) => set({ traded: x === "yes" })}
                      options={[...YES_NO]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="levels" title="Key levels">
        {data.levels.length === 0 ? (
          <p className="text-muted-foreground text-sm">No key levels were prepared for this day.</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="debrief-levels">
            {data.levels.map((l) => {
              const v = snap.levels[l.id] ?? { tested: null, respected: null };
              const set = (p: Partial<typeof v>) =>
                change({ levels: { ...snap.levels, [l.id]: { ...v, ...p } } });
              return (
                <li
                  key={l.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 border-l-4 px-3 py-2 text-sm",
                    l.strength === 3 ? "border-l-primary font-semibold" : "border-l-foreground/20",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground mr-1 text-xs">{l.symbol}</span>
                    <span className="num">{l.price}</span>{" "}
                    <span className="text-muted-foreground text-xs">
                      {l.levelType} · {l.strength}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">Tested</span>
                  <Segmented
                    label={`${l.symbol} ${l.price} tested`}
                    size="sm"
                    value={yn(v.tested)}
                    onChange={(x) =>
                      set({ tested: x === "yes", respected: x === "yes" ? v.respected : null })
                    }
                    options={[...YES_NO]}
                  />
                  {v.tested && (
                    <>
                      <span className="text-muted-foreground text-xs">Respected</span>
                      <Segmented
                        label={`${l.symbol} ${l.price} respected`}
                        size="sm"
                        value={yn(v.respected)}
                        onChange={(x) => set({ respected: x === "yes" })}
                        options={[...YES_NO]}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="grades" title="Pillar grades" required>
        {(
          [
            ["gradeContext", "gradeContextNote", "Context"],
            ["gradeEdge", "gradeEdgeNote", "Edge"],
            ["gradeProcess", "gradeProcessNote", "Process"],
          ] as const
        ).map(([g, note, label]) => (
          <div key={g} className="grid items-center gap-2 sm:grid-cols-[6rem_auto_1fr]">
            <span className="heading-caps text-xs">{label}</span>
            <Segmented
              label={`${label} grade`}
              size="sm"
              value={snap[g]}
              onChange={(v) => change({ [g]: v as Grade })}
              options={GRADES.map((x) => ({ value: x, label: x }))}
            />
            <Input
              aria-label={`${label} — one line`}
              placeholder="One line"
              value={snap[note]}
              onChange={(e) => change({ [note]: e.target.value })}
            />
          </div>
        ))}
      </Section>

      <Section id="rules" title="Rules">
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active rules.</p>
        ) : (
          <ul className="space-y-3" data-testid="debrief-rules">
            {rules.map((r) => {
              const v = snap.rules[r.id] ?? { followed: null, note: "" };
              const set = (p: Partial<typeof v>) =>
                change({ rules: { ...snap.rules, [r.id]: { ...v, ...p } } });
              return (
                <li key={r.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 text-sm">{r.text}</span>
                    <Segmented
                      label={`Rule: ${r.text}`}
                      size="sm"
                      value={v.followed === null ? null : v.followed ? "followed" : "broken"}
                      onChange={(x) => set({ followed: x === "followed" })}
                      options={[
                        { value: "followed", label: "Followed" },
                        { value: "broken", label: "Broken" },
                      ]}
                    />
                  </div>
                  {v.followed === false && (
                    <Input
                      aria-label={`Why was "${r.text}" broken?`}
                      placeholder="What happened? (required)"
                      value={v.note}
                      aria-invalid={!v.note.trim()}
                      onChange={(e) => set({ note: e.target.value })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="reflection" title="Reflection">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["wentWell", "What went well"],
              ["toImprove", "What to improve"],
            ] as const
          ).map(([key, label]) => (
            <fieldset key={key} className="space-y-2">
              <legend className="mb-1.5 text-xs font-medium">{label} (max 3)</legend>
              {snap[key].map((v, i) => (
                <Input
                  key={i}
                  aria-label={`${label} ${i + 1}`}
                  value={v}
                  onChange={(e) => setBullet(key, i, e.target.value)}
                />
              ))}
            </fieldset>
          ))}
        </div>
        <Field id="lesson" label="Lesson of the day (one sentence)">
          <Input
            id="lesson"
            value={snap.lesson}
            onChange={(e) => change({ lesson: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["mood", "energy"] as const).map((k) => (
            <Field
              key={k}
              id={`end-${k}`}
              label={`${k === "mood" ? "Mood" : "Energy"} at the end of the day`}
            >
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
      </Section>

      <Section id="actions" title="Action items">
        <ul className="space-y-2" data-testid="debrief-actions">
          {snap.actions.map((a) => {
            const set = (p: Partial<typeof a>) =>
              change({ actions: snap.actions.map((x) => (x.id === a.id ? { ...x, ...p } : x)) });
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2"
                data-testid="debrief-action"
              >
                <Input
                  aria-label="Action item"
                  placeholder="What will I do differently?"
                  value={a.text}
                  className={cn(
                    "min-w-48 flex-1",
                    a.status !== "open" && "line-through opacity-60",
                  )}
                  onChange={(e) => set({ text: e.target.value })}
                />
                <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={a.showInPrep}
                    onChange={(e) => set({ showInPrep: e.target.checked })}
                  />
                  Show in next prep
                </label>
                <Segmented
                  label="Status"
                  size="sm"
                  value={a.status}
                  onChange={(status) => set({ status })}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "done", label: "Done" },
                    { value: "dropped", label: "Dropped" },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove action item"
                  onClick={() => change({ actions: snap.actions.filter((x) => x.id !== a.id) })}
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
            change({
              actions: [
                ...snap.actions,
                { id: crypto.randomUUID(), text: "", showInPrep: true, status: "open" },
              ],
            })
          }
        >
          <Plus aria-hidden />
          Add action item
        </Button>
        <ActionItemsList items={data.otherActions} title="Still open from earlier" />
      </Section>

      <Section id="media" title="End-of-day media">
        <MediaManager
          ownerType="debrief"
          ownerId={snap.id}
          ready={persisted}
          initial={data.media}
        />
      </Section>

      {!snap.completedAt ? (
        <div className="flex justify-end">
          <Button onClick={complete}>Debrief complete</Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => change({ completedAt: null })}>
            Mark as not complete
          </Button>
        </div>
      )}
    </div>
  );
}
