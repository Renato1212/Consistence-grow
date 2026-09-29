import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DebriefEditorClient } from "@/components/review/debrief-client";
import { BrokerCard } from "@/components/statements/broker-card";
import { isIsoDate } from "@/lib/calendar/dates";
import { loadDebriefPage } from "@/lib/data/debrief";

export const metadata: Metadata = { title: "Debrief" };

export default async function DebriefPage({ params }: PageProps<"/review/[date]">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const data = await loadDebriefPage(date);
  return (
    <>
      <div className="mb-4">
        <BrokerCard from={date} to={date} title="Broker-confirmed P/L" />
      </div>
      <DebriefEditorClient key={date} data={data} />
    </>
  );
}
