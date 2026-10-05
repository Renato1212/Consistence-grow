"use client";

import { useState } from "react";
import Link from "next/link";

import { SaveStatus } from "@/components/trade/save-status";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { SetupScore } from "@/lib/data/routine";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import { useSaveQueue } from "@/lib/hooks/use-save-queue";
import { sampleQuality } from "@/lib/review/stats";
import type { SetupNote, SetupStats, Verdict } from "@/lib/routine/scorecard";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "tweak", label: "Tweak" },
  { value: "drop", label: "Drop" },
];

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function StatLine({ s, label }: { s: SetupStats; label: string }) {
  const q = sampleQuality(s.n);
  return (
    <div className={cn("space-y-0.5", q === "weak" && "text-muted-foreground")}>
      <div className="text-muted-foreground heading-caps text-[10px]">
        {label} · n={s.n}
        {q !== "ok" && s.n > 0 && <span className="ml-1 normal-case">(insufficient data)</span>}
      </div>
      <div className="num flex flex-wrap gap-x-4 text-sm">
        <span title="Win rate, 95% interval">
          Win {pct(s.winRate)}
          {s.winCI && (
            <span className="text-muted-foreground text-xs">
              {" "}
              [{pct(s.winCI.lo)}–{pct(s.winCI.hi)}]
            </span>
          )}
        </span>
        <span title="Average R, 95% interval" className={pnlClass(s.avgR)}>
          Avg {s.avgR === null ? "— R" : fmtR(s.avgR)}
          {s.avgRCI && (
            <span className="text-muted-foreground text-xs">
              {" "}
              [{fmtR(s.avgRCI.lo)} … {fmtR(s.avgRCI.hi)}]
            </span>
          )}
        </span>
        <span className={pnlClass(s.net)}>{fmtMoney(s.net)}</span>
      </div>
    </div>
  );
}

/** Per setup: this week vs all time, plan adherence, and a keep / tweak / drop note. */
export function SetupScorecard({
  year,
  week,
  rows,
}: {
  year: number;
  week: number;
  rows: SetupScore[];
}) {
  const { status, save, retry } = useSaveQueue();
  const [notes, setNotes] = useState<Record<string, SetupNote>>(() =>
    Object.fromEntries(rows.map((r) => [r.playbookId, r.note])),
  );

  function update(id: string, patch: Partial<SetupNote>, immediate = false) {
    const next = { ...notes, [id]: { ...notes[id], ...patch } };
    setNotes(next);
    save(
      "setup-notes",
      () =>
        createClient()
          .from("weekly_reviews")
          .upsert(
            { iso_year: year, iso_week: week, setup_notes: next, deleted_at: null },
            { onConflict: "user_id,iso_year,iso_week" },
          ),
      immediate,
    );
  }

  if (rows.length === 0) return null;
  return (
    <section
      className="bg-card space-y-3 rounded-xl border p-4"
      aria-label="Setup scorecard"
      data-testid="setup-scorecard"
    >
      <div className="flex items-center gap-2">
        <h2 className="heading-caps text-xs">Setup scorecard</h2>
        <div className="ml-auto">
          {status !== "idle" && <SaveStatus status={status} onRetry={retry} />}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Judge a setup on its all-time record, not one week. Below 20 trades, keep collecting.
      </p>
      <ul className="divide-y">
        {rows.map((r) => {
          const a = r.adherence;
          return (
            <li
              key={r.playbookId}
              className="space-y-3 py-3"
              data-testid="setup-row"
              data-playbook={r.playbookId}
            >
              <Link
                href={`/playbook/${r.playbookId}`}
                className="text-sm font-semibold hover:underline"
              >
                {r.name}
              </Link>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatLine s={r.week} label="This week" />
                <StatLine s={r.allTime} label="All time" />
              </div>
              <p className="text-xs" data-testid="setup-adherence">
                Plan followed this week:{" "}
                {a.answered === 0 ? (
                  <span className="text-muted-foreground">no debrief answers yet</span>
                ) : (
                  <span className="num">
                    {Math.round((a.yes / a.answered) * 100)}% ({a.yes} yes · {a.partly} partly ·{" "}
                    {a.no} no)
                  </span>
                )}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Segmented
                  size="sm"
                  label={`Verdict: ${r.name}`}
                  value={notes[r.playbookId]?.verdict ?? null}
                  onChange={(v) => update(r.playbookId, { verdict: v }, true)}
                  options={VERDICTS}
                />
                <Input
                  aria-label={`Note: ${r.name}`}
                  placeholder="What to keep, change or stop?"
                  maxLength={500}
                  value={notes[r.playbookId]?.note ?? ""}
                  onChange={(e) => update(r.playbookId, { note: e.target.value })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
