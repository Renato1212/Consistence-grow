"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { SaveStatus } from "@/components/trade/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { QuickDebriefData } from "@/lib/data/routine";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import { useSaveQueue } from "@/lib/hooks/use-save-queue";
import { tradesInBlock } from "@/lib/routine/schedule";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

type Followed = "yes" | "partly" | "no";
type Grade = "A" | "B" | "C" | "F";
type BlockAnswer = { followed: Followed | null; lesson: string };

const FOLLOWED: { value: Followed; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
];
const GRADES: { value: Grade; label: string }[] = (["A", "B", "C", "F"] as const).map((g) => ({
  value: g,
  label: g,
}));

const hhmm = (iso: string) => formatInTz(iso, DISPLAY_TZ, "HH:mm");

function sum(xs: (number | null)[]) {
  const vals = xs.filter((x): x is number => x !== null);
  return vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) * 100) / 100 : null;
}

/**
 * The 2-minute debrief: per routine block "did I follow the plan?" with the
 * result filled in, one line each, then a grade and the lesson of the day.
 */
export function QuickDebrief({ data }: { data: QuickDebriefData }) {
  const { status, save, retry } = useSaveQueue();
  const [answers, setAnswers] = useState<Record<string, BlockAnswer>>(() =>
    Object.fromEntries(
      data.blocks.map((b) => [
        b.key,
        { followed: data.days[b.key]?.followed ?? null, lesson: data.days[b.key]?.lesson ?? "" },
      ]),
    ),
  );
  const [grade, setGrade] = useState<Grade | null>(data.grade);
  const [lesson, setLesson] = useState(data.lesson);
  const [completed, setCompleted] = useState(data.completed);

  const inBlocks = new Set(
    data.blocks.flatMap((b) => tradesInBlock(b, data.trades)).map((t) => t.id),
  );
  const outside = data.trades.filter((t) => !inBlocks.has(t.id));
  const dayNet = sum(data.trades.map((t) => t.net));
  const dayR = sum(data.trades.map((t) => t.rMultiple));

  function persist(
    next: { answers?: Record<string, BlockAnswer>; grade?: Grade | null; lesson?: string },
    complete = false,
    immediate = false,
  ) {
    const a = next.answers ?? answers;
    const g = next.grade !== undefined ? next.grade : grade;
    const l = next.lesson ?? lesson;
    save(
      "quick-debrief",
      () =>
        createClient().rpc("save_quick_debrief", {
          p_date: data.date,
          p_grade: g as string,
          p_lesson: l,
          p_blocks: Object.entries(a).map(([block, v]) => ({
            block,
            followed: v.followed ?? "",
            lesson: v.lesson,
          })),
          p_complete: complete,
        }),
      immediate,
    );
  }

  function setAnswer(key: string, patch: Partial<BlockAnswer>, immediate = false) {
    const next = { ...answers, [key]: { ...answers[key], ...patch } };
    setAnswers(next);
    persist({ answers: next }, false, immediate);
  }

  async function finish() {
    if (!grade) {
      toast.error("Grade the day to finish.");
      return;
    }
    const { error } = await createClient().rpc("save_quick_debrief", {
      p_date: data.date,
      p_grade: grade,
      p_lesson: lesson,
      p_blocks: Object.entries(answers).map(([block, v]) => ({
        block,
        followed: v.followed ?? "",
        lesson: v.lesson,
      })),
      p_complete: true,
    });
    if (error) {
      toast.error("Not saved — retry.");
      return;
    }
    setCompleted(true);
    toast.success("Debrief done");
  }

  return (
    <section className="space-y-4" aria-label="2-minute debrief" data-testid="quick-debrief">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="heading-caps text-sm">2-minute debrief</h2>
        <span className="num text-muted-foreground text-xs">
          {data.trades.length} trade{data.trades.length === 1 ? "" : "s"}
          {dayNet !== null && (
            <>
              {" · "}
              <span className={pnlClass(dayNet)}>{fmtMoney(dayNet)}</span>
            </>
          )}
          {dayR !== null && (
            <>
              {" · "}
              <span className={pnlClass(dayR)}>{fmtR(dayR)}</span>
            </>
          )}
        </span>
        <div className="ml-auto">
          <SaveStatus status={status === "idle" ? "saved" : status} onRetry={retry} />
        </div>
      </div>

      {data.blocks.length === 0 && (
        <p className="text-muted-foreground text-sm">No routine blocks were scheduled this day.</p>
      )}

      <ol className="space-y-3">
        {data.blocks.map((b) => {
          const mine = tradesInBlock(b, data.trades);
          const net = sum(mine.map((t) => t.net));
          const r = sum(mine.map((t) => t.rMultiple));
          const ans = answers[b.key];
          const row = data.days[b.key];
          return (
            <li
              key={b.key}
              className="bg-card space-y-3 rounded-xl border p-4"
              data-testid="debrief-block"
              data-block={b.key}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="num text-muted-foreground text-xs">
                  {hhmm(b.startAt)}–{hhmm(b.endAt)}
                </span>
                <h3 className="text-sm font-semibold">{b.title}</h3>
                <span className="num ml-auto text-xs" data-testid="block-result">
                  {mine.length === 0 ? (
                    <span className="text-muted-foreground">
                      {row?.noTrade ? "No trade (no qualifying event)" : "No trades"}
                    </span>
                  ) : (
                    <>
                      {mine.length} trade{mine.length === 1 ? "" : "s"}
                      {net !== null && (
                        <span className={cn("ml-2", pnlClass(net))}>{fmtMoney(net)}</span>
                      )}
                      {r !== null && <span className={cn("ml-2", pnlClass(r))}>{fmtR(r)}</span>}
                    </>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-xs">Followed the plan?</span>
                <Segmented
                  size="sm"
                  label={`Followed the plan: ${b.title}`}
                  value={ans.followed}
                  onChange={(v) => setAnswer(b.key, { followed: v }, true)}
                  options={FOLLOWED}
                />
              </div>
              <Input
                aria-label={`Lesson: ${b.title}`}
                placeholder="One line (optional)"
                maxLength={300}
                value={ans.lesson}
                onChange={(e) => setAnswer(b.key, { lesson: e.target.value })}
              />
              {b.playbookId && data.setups[b.playbookId] && (
                <p className="text-muted-foreground text-xs">Setup: {data.setups[b.playbookId]}</p>
              )}
            </li>
          );
        })}
      </ol>

      {outside.length > 0 && (
        <p className="text-warn text-sm" data-testid="outside-routine">
          {outside.length} trade{outside.length === 1 ? "" : "s"} outside the routine
          {sum(outside.map((t) => t.net)) !== null &&
            ` (${fmtMoney(sum(outside.map((t) => t.net)))})`}
          . Was it a plan, or an impulse?
        </p>
      )}

      <div className="bg-card space-y-4 rounded-xl border p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium">Grade the day (process)</p>
          <Segmented
            label="Process grade"
            value={grade}
            onChange={(g) => {
              setGrade(g);
              persist({ grade: g }, false, true);
            }}
            options={GRADES}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="quick-lesson" className="text-xs font-medium">
            Lesson of the day (one sentence)
          </label>
          <Input
            id="quick-lesson"
            maxLength={300}
            value={lesson}
            onChange={(e) => {
              setLesson(e.target.value);
              persist({ lesson: e.target.value });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {completed ? (
            <span
              className="inline-flex items-center gap-1.5 text-sm"
              data-testid="quick-debrief-complete"
            >
              <CheckCircle2 className="text-profit size-4" aria-hidden />
              Debrief done. Everything stays editable.
            </span>
          ) : (
            <Button onClick={finish}>Done</Button>
          )}
          <Link
            href={`/review/${data.date}?full=1`}
            className="text-primary-ink ml-auto text-sm hover:underline"
          >
            {data.hasFull ? "Open the full debrief →" : "Full debrief (optional) →"}
          </Link>
        </div>
      </div>
    </section>
  );
}
