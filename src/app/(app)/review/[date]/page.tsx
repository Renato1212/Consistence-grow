import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DebriefEditorClient } from "@/components/review/debrief-client";
import { QuickDebrief } from "@/components/review/quick-debrief";
import { PageHeader } from "@/components/shell/empty-state";
import { BrokerCard } from "@/components/statements/broker-card";
import { isIsoDate } from "@/lib/calendar/dates";
import { loadDebriefPage } from "@/lib/data/debrief";
import { loadQuickDebrief } from "@/lib/data/routine";
import { formatInTz } from "@/lib/time";

export const metadata: Metadata = { title: "Debrief" };

/**
 * The 2-minute debrief by default; the full debrief (plan vs reality, three
 * grades, rules, action items) with ?full=1. Each view loads fresh data, so
 * one never overwrites the other with stale values.
 */
export default async function DebriefPage({ params, searchParams }: PageProps<"/review/[date]">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const full = (await searchParams).full === "1";
  if (full) {
    const data = await loadDebriefPage(date);
    return (
      <>
        <div className="mb-4 flex flex-col gap-3">
          <Link href={`/review/${date}`} className="text-primary-ink text-sm hover:underline">
            ← 2-minute debrief
          </Link>
          <BrokerCard from={date} to={date} title="Broker-confirmed P/L" />
        </div>
        <DebriefEditorClient key={date} data={data} />
      </>
    );
  }
  const data = await loadQuickDebrief(date);
  return (
    <>
      <PageHeader title="Debrief">
        <span className="text-muted-foreground text-sm">
          {formatInTz(`${date}T12:00:00Z`, "UTC", "EEEE d MMMM")}
        </span>
      </PageHeader>
      <div className="mb-4">
        <BrokerCard from={date} to={date} title="Broker-confirmed P/L" />
      </div>
      <QuickDebrief key={date} data={data} />
    </>
  );
}
