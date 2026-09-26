import type { Metadata } from "next";
import { LineChart } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <>
      <PageHeader title="Insights" />
      <EmptyState
        icon={LineChart}
        title="Nothing to analyse yet"
        description="Statistics with sample sizes and confidence intervals, the pattern finder and AI analysis arrive in Phases 6–7, once trades exist."
      />
    </>
  );
}
