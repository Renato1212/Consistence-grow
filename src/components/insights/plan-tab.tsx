"use client";

import {
  levelRespect,
  planAlignment,
  scenarioOutcomes,
  type RateRow,
} from "@/lib/insights/analysis";
import type { InsightTrade, LevelFact, ScenarioFact } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPctCI, MetricsTable, N, Section } from "./bits";
import { weakClass } from "@/components/review/stat-bits";

const OUTCOME_LABEL = { played: "Played out", partial: "Partially", didnt: "Didn't play" };

function RateTable({ rows, label, testId }: { rows: RateRow[]; label: string; testId: string }) {
  if (!rows.length)
    return <p className="text-muted-foreground text-sm">No tested levels with an outcome yet.</p>;
  return (
    <table className="w-full text-sm" data-testid={testId}>
      <thead className="text-muted-foreground text-xs">
        <tr className="border-b">
          <th className="py-2 text-left font-normal">{label}</th>
          <th className="px-2 text-right font-normal">Tested</th>
          <th className="px-2 text-right font-normal">Respected (95% CI)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cn("border-b last:border-0", weakClass(r.n))}>
            <td className="py-1.5">{r.label}</td>
            <td className="px-2 text-right">
              <N n={r.n} />
            </td>
            <td className="num px-2 text-right">
              {fmtPct(r.rate)}{" "}
              <span className="text-muted-foreground text-xs">{fmtPctCI(r.ci)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PlanTab({
  trades,
  scenarios,
  levels,
}: {
  trades: InsightTrade[];
  scenarios: ScenarioFact[];
  levels: LevelFact[];
}) {
  const s = scenarioOutcomes(scenarios);
  return (
    <div className="space-y-4">
      <Section
        title="Scenarios"
        description={`If → then scenarios from preps in the date range, graded in the debrief. ${s.ungraded} not graded yet.`}
      >
        <div className="num text-sm" data-testid="scenario-hit">
          Hit rate {fmtPct(s.hit.rate)}{" "}
          <span className="text-muted-foreground text-xs">{fmtPctCI(s.hit.ci)}</span> · n{" "}
          <N n={s.graded} />
        </div>
        <table className="w-full text-sm" data-testid="scenario-table">
          <thead className="text-muted-foreground text-xs">
            <tr className="border-b">
              <th className="py-2 text-left font-normal">Outcome</th>
              <th className="px-2 text-right font-normal">Scenarios</th>
              <th className="px-2 text-right font-normal">Traded</th>
              <th className="px-2 text-right font-normal">Not traded</th>
              <th className="px-2 text-right font-normal">Unknown</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.outcome} className="border-b last:border-0">
                <td className="py-1.5">{OUTCOME_LABEL[r.outcome]}</td>
                <td className="num px-2 text-right">{r.total}</td>
                <td className="num px-2 text-right">{r.traded}</td>
                <td className="num px-2 text-right">{r.notTraded}</td>
                <td className="num text-muted-foreground px-2 text-right">{r.unknown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Key levels by type" description="Tested levels only.">
          <RateTable rows={levelRespect(levels, "type")} label="Level type" testId="levels-type" />
        </Section>
        <Section title="Key levels by strength" description="Tested levels only.">
          <RateTable
            rows={levelRespect(levels, "strength")}
            label="Strength"
            testId="levels-strength"
          />
        </Section>
      </div>

      <Section
        title="Trades vs the plan"
        description="Trades linked to a prep scenario or key level compared with trades that were not."
      >
        <MetricsTable rows={planAlignment(trades)} dimension="Trades" testId="plan-table" />
      </Section>
    </div>
  );
}
