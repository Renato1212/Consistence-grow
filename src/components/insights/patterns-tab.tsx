"use client";

import { useState } from "react";
import { Filter as FilterIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { logClientError } from "@/lib/client-errors";
import { DOMAIN_CODES, domainLabel } from "@/lib/domains";
import { fmtDuration, fmtR, pnlClass } from "@/lib/format";
import {
  breakdownBy,
  domainPairs,
  findPatterns,
  moveProfile,
  type Pattern,
} from "@/lib/insights/analysis";
import { DIMENSION_BY_KEY, type DimensionKey } from "@/lib/insights/dimensions";
import { FILTER_PARAMS, withValue, type Filter, type FilterKey } from "@/lib/insights/filters";
import type { InsightTrade } from "@/lib/insights/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  DrillButton,
  fmtPct,
  fmtPctCI,
  fmtRCI,
  HypothesisNote,
  MetricsTable,
  N,
  Section,
  useDrill,
} from "./bits";

const READINESS_RANGE: Record<string, [number | null, number | null]> = {
  "< 2.5": [null, 2.49],
  "2.5–3.5": [2.5, 3.49],
  "≥ 3.5": [3.5, null],
};

/** Narrow the global filter to a pattern's conditions. */
export function applyPattern(f: Filter, p: Pattern): Filter {
  let out = f;
  for (const c of p.conditions) {
    if (c.dim === "readiness") {
      const [lo, hi] = READINESS_RANGE[c.value] ?? [null, null];
      out = { ...out, readinessMin: lo, readinessMax: hi };
    } else if (c.dim in FILTER_PARAMS) {
      out = withValue(out, c.dim as FilterKey, c.value);
      if (c.dim === "tag") out = { ...out, tagMode: "all" };
    }
  }
  return out;
}

function PatternList({
  title,
  patterns,
  testId,
  onFilter,
}: {
  title: string;
  patterns: Pattern[];
  testId: string;
  onFilter: (p: Pattern) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="heading-caps text-xs">{title}</h3>
      {patterns.length === 0 ? (
        <p className="text-muted-foreground text-sm">No combination qualifies.</p>
      ) : (
        <ol className="space-y-2" data-testid={testId}>
          {patterns.map((p) => (
            <li key={p.label} className="rounded-lg border p-3" data-testid="pattern">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm font-medium">{p.label}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Filter to ${p.label}`}
                  onClick={() => onFilter(p)}
                >
                  <FilterIcon aria-hidden />
                </Button>
                <DrillButton title={p.label} ids={p.ids} />
              </div>
              <div className="num mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>
                  n <N n={p.n} />
                </span>
                <span>
                  exp <span className={pnlClass(p.expectancy)}>{fmtR(p.expectancy)}</span>{" "}
                  <span className="text-muted-foreground">{fmtRCI(p.expCI)}</span>
                </span>
                <span>
                  lift <span className={pnlClass(p.lift)}>{fmtR(p.lift)}</span>
                </span>
                <span>
                  win {fmtPct(p.winRate)}{" "}
                  <span className="text-muted-foreground">{fmtPctCI(p.winCI)}</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MinN({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= 3 && parsed <= 100;

  async function save() {
    if (!valid || parsed === value) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("user_settings")
      .update({ pattern_min_n: parsed })
      .not("id", "is", null);
    setBusy(false);
    if (error) {
      logClientError("user_settings.pattern_min_n", error);
      toast.error("Not saved — retry.");
      return;
    }
    onChange(parsed);
    toast.success(`Minimum n set to ${parsed}`);
  }

  return (
    <form
      className="flex items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="pattern-min-n" className="text-muted-foreground">
        Minimum n (trades with R)
      </label>
      <Input
        id="pattern-min-n"
        type="number"
        min={3}
        max={100}
        className="h-8 w-16"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={!valid}
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={!valid || busy || parsed === value}
      >
        Save
      </Button>
    </form>
  );
}

function ConfluenceMatrix({ trades }: { trades: InsightTrade[] }) {
  const drill = useDrill();
  const pairs = domainPairs(trades);
  const cell = (a: string, b: string) =>
    pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))!;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table
        className="num w-full min-w-[480px] table-fixed border-separate border-spacing-0.5 text-xs"
        data-testid="pair-matrix"
      >
        <thead>
          <tr>
            <th />
            {DOMAIN_CODES.map((d) => (
              <th key={d} className="text-muted-foreground font-normal">
                {domainLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOMAIN_CODES.map((a, i) => (
            <tr key={a}>
              <th className="text-muted-foreground pr-2 text-left font-normal whitespace-nowrap">
                {domainLabel(a)}
              </th>
              {DOMAIN_CODES.map((b, j) => {
                if (j > i) return <td key={b} />;
                const c = cell(a, b);
                const label =
                  a === b ? `${domainLabel(a)} only` : `${domainLabel(a)} + ${domainLabel(b)}`;
                return (
                  <td key={b} className="p-0">
                    <button
                      type="button"
                      disabled={c.ids.length === 0}
                      onClick={() => drill(label, c.ids)}
                      className={cn(
                        "hover:ring-foreground/40 focus-visible:ring-ring flex h-11 w-full flex-col items-center justify-center rounded-sm border outline-none hover:ring-1 focus-visible:ring-2 disabled:opacity-40",
                        a === b && "border-dashed",
                        c.rN > 0 && c.rN < 10 && "opacity-60",
                      )}
                      aria-label={`${label}: n ${c.rN}, expectancy ${fmtR(c.exp)}`}
                    >
                      <span className={cn("font-semibold", pnlClass(c.exp))}>
                        {c.exp === null ? "—" : fmtR(c.exp)}
                      </span>
                      <span className="text-muted-foreground text-[10px]">n={c.rN}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MOVE_DIMS: DimensionKey[] = ["domain", "timeBucket", "event", "instrument", "weekday"];

function ObservedMoves({ observed }: { observed: InsightTrade[] }) {
  const [by, setBy] = useState<DimensionKey>("domain");
  const rows = moveProfile(observed, by);
  const label = DIMENSION_BY_KEY[by].label;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="heading-caps text-xs">Observed fast moves (n={observed.length})</h3>
        <NativeSelect
          aria-label="Group observed moves by"
          className="h-8 w-48 text-xs"
          value={by}
          onChange={(e) => setBy(e.target.value as DimensionKey)}
        >
          {MOVE_DIMS.map((d) => (
            <option key={d} value={d}>
              {DIMENSION_BY_KEY[d].label === "Primary domain"
                ? "Trigger domain"
                : DIMENSION_BY_KEY[d].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No observed moves in this filter.</p>
      ) : (
        <table className="w-full text-sm" data-testid="observed-table">
          <thead className="text-muted-foreground text-xs">
            <tr className="border-b">
              <th className="py-2 text-left font-normal">
                {by === "domain" ? "Trigger domain" : label}
              </th>
              <th className="px-2 text-right font-normal">n</th>
              <th className="px-2 text-right font-normal">Median size</th>
              <th className="px-2 text-right font-normal">Median duration</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="py-1.5">{r.label}</td>
                <td className="px-2 text-right">
                  <N n={r.n} />
                </td>
                <td className="num px-2 text-right">
                  {r.medianTicks === null ? "—" : `${r.medianTicks} ticks`}
                </td>
                <td className="num px-2 text-right">
                  {fmtDuration(r.medianDuration === null ? null : Math.round(r.medianDuration))}
                </td>
                <td className="text-right">
                  <DrillButton title={`Observed: ${r.label}`} ids={r.ids} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PatternsTab({
  trades,
  missed,
  observed,
  minN,
  onMinN,
  filter,
  onFilter,
}: {
  trades: InsightTrade[];
  missed: InsightTrade[];
  observed: InsightTrade[];
  minN: number;
  onMinN: (n: number) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const res = findPatterns(trades, minN);
  const confluence = breakdownBy(trades, "domainCount");
  const missedRows = breakdownBy(missed, "playbook");
  const missedR = missed.reduce((a, t) => a + (t.r_multiple ?? 0), 0);

  return (
    <div className="space-y-4">
      <Section
        title="Pattern finder"
        aside={<MinN value={minN} onChange={onMinN} />}
        description={`Every 2- and 3-attribute combination inside the current filter with at least ${minN} trades with R, ranked by expectancy lift over the baseline.`}
      >
        <div className="num text-muted-foreground text-xs" data-testid="pattern-baseline">
          Baseline: {res.baseline.rN} trades with R · expectancy{" "}
          <span className={pnlClass(res.baseline.expectancy)}>{fmtR(res.baseline.expectancy)}</span>{" "}
          · {res.tested} combinations tested
        </div>
        <HypothesisNote>
          With {res.tested} combinations tested, some will look strong or weak by chance alone.
          Check the interval and n, then test the idea forward before trading it.
        </HypothesisNote>
        <div className="grid gap-4 lg:grid-cols-2">
          <PatternList
            title="Strongest conditions"
            patterns={res.strongest}
            testId="patterns-strongest"
            onFilter={(p) => onFilter(applyPattern(filter, p))}
          />
          <PatternList
            title="Leaks"
            patterns={res.leaks}
            testId="patterns-leaks"
            onFilter={(p) => onFilter(applyPattern(filter, p))}
          />
        </div>
      </Section>

      <Section
        title="Domain confluence"
        description="Single-domain trades vs 2 vs 3+ domains, and every domain pair (dashed diagonal = that domain alone). Cells show expectancy and trades with R."
      >
        <MetricsTable rows={confluence} dimension="Confluence" testId="confluence-table" />
        <ConfluenceMatrix trades={trades} />
      </Section>

      <Section
        title="Missed & observed"
        description="Missed trades are setups you saw and didn't take (hypothetical result); observed moves are studies without a position. Both ignore the Kinds filter."
      >
        <div className="space-y-2">
          <h3 className="heading-caps text-xs">
            Missed trades by playbook — left on the table{" "}
            <span className={cn("num", pnlClass(missedR))}>
              {missed.length ? fmtR(Math.round(missedR * 100) / 100) : ""}
            </span>
          </h3>
          <MetricsTable rows={missedRows} dimension="Playbook" testId="missed-table" />
        </div>
        <ObservedMoves observed={observed} />
      </Section>
    </div>
  );
}
