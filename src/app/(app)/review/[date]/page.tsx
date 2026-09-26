import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DebriefEditorClient } from "@/components/review/debrief-client";
import { isIsoDate } from "@/lib/calendar/dates";
import { loadDebriefPage } from "@/lib/data/debrief";

export const metadata: Metadata = { title: "Debrief" };

export default async function DebriefPage({ params }: PageProps<"/review/[date]">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const data = await loadDebriefPage(date);
  return <DebriefEditorClient key={date} data={data} />;
}
