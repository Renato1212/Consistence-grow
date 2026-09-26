import type { Metadata } from "next";
import Link from "next/link";
import { LineChart } from "lucide-react";

import { InsightsView } from "@/components/insights/insights-view";
import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { hasAiToken, loadAiInsights, loadAiRequests, loadPlaybookOptions } from "@/lib/data/ai";
import { loadInsights } from "@/lib/data/insights";
import { parseFilter } from "@/lib/insights/filters";
import { parseDimension, parseTab } from "@/lib/insights/view-state";
import { lisbonToday } from "@/lib/time";

export const metadata: Metadata = { title: "Insights" };

function toParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, x);
  }
  return p;
}

export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  const params = toParams(await searchParams);
  const today = lisbonToday();
  const [data, insights, requests, playbooks, hasToken] = await Promise.all([
    loadInsights(),
    loadAiInsights(),
    loadAiRequests(),
    loadPlaybookOptions(),
    hasAiToken(),
  ]);

  if (data.trades.length === 0) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState
          icon={LineChart}
          title="Nothing to analyse yet"
          description="Log trades and Insights shows your statistics with sample sizes and confidence intervals, breakdowns by every attribute, and the pattern finder."
        >
          <Button asChild>
            <Link href="/journal/new">Log trade</Link>
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Insights" />
      <InsightsView
        data={data}
        today={today}
        initial={{
          filter: parseFilter(params),
          tab: parseTab(params.get("tab")),
          dimension: parseDimension(params.get("by")),
        }}
        ai={{ insights, requests, playbooks, hasToken }}
      />
    </>
  );
}
