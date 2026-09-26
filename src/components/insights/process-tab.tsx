"use client";

import { isoWeekKey, isoWeekOf } from "@/lib/calendar/dates";
import { fmtR, pnlClass } from "@/lib/format";
import {
  breakdownBy,
  mistakeCosts,
  processMatrix,
  ruleViolationsByWeek,
  type QuadKey,
} from "@/lib/insights/analysis";
import type { InsightTrade, RuleCheckFact, TagInfo } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { DrillButton, MetricsTable, N, Section, useDrill } from "./bits";

const QUAD: Record<QuadKey, { title: string; note: string }> = {
  "good-good": { title: "Good process · win", note: "Earned — repeat it." },
  "good-bad": { title: "Good process · loss", note: "Cost of doing business." },
  "bad-good": { title: "Bad process · win", note: "Lucky — the dangerous one." },
  "bad-bad": { title: "Bad process · loss", note: "Deserved — fix the process." },
};

function weekOf(date: string) {
  const w = isoWeekOf(date);
  return isoWeekKey(w.year, w.week);
}

export function ProcessTab({
  trades,
  tags,
  ruleChecks,
}: {
  trades: InsightTrade[];
  tags: TagInfo[];
  ruleChecks: RuleCheckFact[];
}) {
  const drill = useDrill();
  const { quads, excluded } = processMatrix(trades);
  const q = Object.fromEntries(quads.map((x) => [x.key, x])) as Record<
    QuadKey,
    (typeof quads)[number]
  >;
  const graded = quads.reduce((a, x) => a + x.ids.length, 0);
  const mistakes = mistakeCosts(trades, tags);
  const weeks = ruleViolationsByWeek(ruleChecks, weekOf);
  const maxChecks = Math.max(1, ...weeks.map((w) => w.checks));

  const quad = (k: QuadKey) => {
    const x = q[k];
    const share = graded ? Math.round((x.ids.length / graded) * 100) : 0;
    return (
      <button
        type="button"
        key={k}
        onClick={() => drill(QUAD[k].title, x.ids)}
        disabled={!x.ids.length}
        className={cn(
          "hover:ring-foreground/30 focus-visible:ring-ring rounded-lg border p-3 text-left outline-none hover:ring-1 focus-visible:ring-2 disabled:cursor-default",
          k === "bad-good" && "border-amber-500/50",
        )}
        data-testid={`quad-${k}`}
      >
        <div className="text-xs font-semibold">{QUAD[k].title}</div>
        <div className="num mt-1 text-2xl font-semibold">{x.ids.length}</div>
        <div className="num text-muted-foreground text-xs">
          {share}% · <span className={pnlClass(x.netR)}>{x.rN ? fmtR(x.netR) : "no R"}</span>
        </div>
        <div className="text-muted-foreground mt-1 text-xs">{QUAD[k].note}</div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <Section
        title="Process vs outcome"
        description={`Process grade A/B = good, C/F = bad; outcome by net result. ${graded} graded trades${excluded ? `, ${excluded} ungraded or scratch excluded` : ""}.`}
      >
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs">
          <div />
          <div className="text-muted-foreground text-center">Win</div>
          <div className="text-muted-foreground text-center">Loss</div>
          <div className="text-muted-foreground flex rotate-180 items-center [writing-mode:vertical-rl]">
            Good
          </div>
          {quad("good-good")}
          {quad("good-bad")}
          <div className="text-muted-foreground flex rotate-180 items-center [writing-mode:vertical-rl]">
            Bad
          </div>
          {quad("bad-good")}
          {quad("bad-bad")}
        </div>
      </Section>

      <Section
        title="Mistakes"
        description="Tags from “mistake” groups: how often, and what the trades carrying them returned in R."
      >
        {mistakes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No trades tagged with a mistake in this filter.
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="mistakes-table">
            <thead className="text-muted-foreground text-xs">
              <tr className="border-b">
                <th className="py-2 text-left font-normal">Mistake</th>
                <th className="px-2 text-right font-normal">n</th>
                <th className="px-2 text-right font-normal">Total R</th>
                <th className="px-2 text-right font-normal">Avg R</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {mistakes.map((m) => (
                <tr key={m.tag} className="border-b last:border-0">
                  <td className="py-1.5">{m.tag}</td>
                  <td className="px-2 text-right">
                    <N n={m.n} />
                  </td>
                  <td className={cn("num px-2 text-right", pnlClass(m.costR))}>
                    {m.rN ? fmtR(m.costR) : "—"}
                  </td>
                  <td className={cn("num px-2 text-right", pnlClass(m.avgR))}>{fmtR(m.avgR)}</td>
                  <td className="text-right">
                    <DrillButton title={`Mistake: ${m.tag}`} ids={m.ids} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Rule violations per week"
        description="From debrief rule checks in the date range."
      >
        {weeks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No debrief rule checks in this range.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="violations">
            {weeks.map((w) => (
              <li
                key={w.week}
                className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="num text-muted-foreground">{w.week}</span>
                <div
                  className="bg-muted relative h-3 overflow-hidden rounded-sm"
                  style={{ width: `${Math.max(8, (w.checks / maxChecks) * 100)}%` }}
                  title={Object.entries(w.rules)
                    .map(([r, n]) => `${r} ×${n}`)
                    .join("\n")}
                >
                  <div
                    className="bg-primary absolute inset-y-0 left-0 rounded-sm"
                    style={{ width: `${(w.violations / w.checks) * 100}%` }}
                  />
                </div>
                <span className="num">
                  {w.violations}/{w.checks} broken
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Readiness vs results"
          description="Average of sleep, energy and focus from the session prep."
        >
          <MetricsTable
            rows={breakdownBy(trades, "readiness")}
            dimension="Readiness"
            testId="readiness-table"
          />
        </Section>
        <Section title="Prep done vs not">
          <MetricsTable rows={breakdownBy(trades, "prep")} dimension="Prep" testId="prep-table" />
        </Section>
      </div>
    </div>
  );
}
