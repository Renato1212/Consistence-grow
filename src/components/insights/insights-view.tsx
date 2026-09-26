"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightsData } from "@/lib/data/insights";
import type { DimensionKey } from "@/lib/insights/dimensions";
import {
  applyFilter,
  dateBounds,
  matchesExceptKind,
  parseFilter,
  RANGE_LABEL,
  type Filter,
} from "@/lib/insights/filters";
import { insightsQuery, parseDimension, parseTab, TABS, type Tab } from "@/lib/insights/view-state";
import { DrillContext, N } from "./bits";
import { BreakdownsTab } from "./breakdowns-tab";
import { FilterBar } from "./filter-bar";
import { OverviewTab } from "./overview-tab";
import { PatternsTab } from "./patterns-tab";
import { PlanTab } from "./plan-tab";
import { ProcessTab } from "./process-tab";
import { SavedViews } from "./saved-views";
import { TradeListSheet } from "./trade-list-sheet";

const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  breakdowns: "Breakdowns",
  patterns: "Pattern finder",
  process: "Process",
  plan: "Plan accuracy",
};

export function InsightsView({
  data,
  today,
  initial,
}: {
  data: InsightsData;
  today: string;
  initial: { filter: Filter; tab: Tab; dimension: DimensionKey };
}) {
  const [filter, setFilterState] = useState(initial.filter);
  const [tab, setTabState] = useState(initial.tab);
  const [dimension, setDimensionState] = useState(initial.dimension);
  const [minN, setMinN] = useState(data.patternMinN);
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null);

  // URL is the source of truth for sharing/reload: mirror every change, follow back/forward.
  function commit(next: { filter?: Filter; tab?: Tab; dimension?: DimensionKey }) {
    const f = next.filter ?? filter;
    const t = next.tab ?? tab;
    const d = next.dimension ?? dimension;
    if (next.filter) setFilterState(f);
    if (next.tab) setTabState(t);
    if (next.dimension) setDimensionState(d);
    window.history.replaceState(window.history.state, "", `/insights${insightsQuery(f, t, d)}`);
  }
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      setFilterState(parseFilter(p));
      setTabState(parseTab(p.get("tab")));
      setDimensionState(parseDimension(p.get("by")));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const byId = useMemo(() => new Map(data.trades.map((t) => [t.id, t])), [data.trades]);
  const filtered = useMemo(
    () => applyFilter(data.trades, filter, today),
    [data.trades, filter, today],
  );
  const sideSets = useMemo(() => {
    const rest = data.trades.filter(
      (t) => t.kind !== "taken" && matchesExceptKind(t, filter, today),
    );
    return {
      missed: rest.filter((t) => t.kind === "missed"),
      observed: rest.filter((t) => t.kind === "observed"),
    };
  }, [data.trades, filter, today]);
  const bounds = dateBounds(filter, today);
  const inRange = (d: string) =>
    (!bounds.from || d >= bounds.from) && (!bounds.to || d <= bounds.to);
  const instruments = filter.values.instrument;
  const scenarios = data.scenarios.filter(
    (s) =>
      inRange(s.date) &&
      (!instruments?.length || (s.instrument && instruments.includes(s.instrument))),
  );
  const levels = data.levels.filter(
    (l) => inRange(l.date) && (!instruments?.length || instruments.includes(l.instrument)),
  );
  const ruleChecks = data.ruleChecks.filter((c) => inRange(c.date));
  const hypothetical = filter.kinds.some((k) => k !== "taken");

  return (
    <DrillContext.Provider value={(title, ids) => setDrill({ title, ids })}>
      <div className="space-y-4">
        <FilterBar
          filter={filter}
          onChange={(f) => commit({ filter: f })}
          trades={data.trades}
          playbooks={data.playbooks}
          views={
            <SavedViews views={data.views} filter={filter} onApply={(f) => commit({ filter: f })} />
          }
        />

        <div
          className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          data-testid="insights-scope"
        >
          <span>
            {RANGE_LABEL[filter.range]}
            {filter.range === "custom" && ` ${filter.from ?? "…"} → ${filter.to ?? "…"}`}
          </span>
          <span>
            n <N n={filtered.length} />
          </span>
          {hypothetical && (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <AlertTriangle className="size-3.5" aria-hidden />
              Includes missed/observed trades: hypothetical results.
            </span>
          )}
          {data.truncated && (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <AlertTriangle className="size-3.5" aria-hidden />
              Only the newest {data.trades.length.toLocaleString("en-US")} trades are analysed.
            </span>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => commit({ tab: parseTab(v) })}>
          <div className="-mx-4 overflow-x-auto px-4">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABEL[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="overview">
            <OverviewTab trades={filtered} />
          </TabsContent>
          <TabsContent value="breakdowns">
            <BreakdownsTab
              trades={filtered}
              dimension={dimension}
              onDimension={(d) => commit({ dimension: d })}
            />
          </TabsContent>
          <TabsContent value="patterns">
            <PatternsTab
              trades={filtered}
              missed={sideSets.missed}
              observed={sideSets.observed}
              minN={minN}
              onMinN={setMinN}
              filter={filter}
              onFilter={(f) => commit({ filter: f })}
            />
          </TabsContent>
          <TabsContent value="process">
            <ProcessTab trades={filtered} tags={data.tags} ruleChecks={ruleChecks} />
          </TabsContent>
          <TabsContent value="plan">
            <PlanTab trades={filtered} scenarios={scenarios} levels={levels} />
          </TabsContent>
        </Tabs>
      </div>
      <TradeListSheet drill={drill} byId={byId} onClose={() => setDrill(null)} />
    </DrillContext.Provider>
  );
}
