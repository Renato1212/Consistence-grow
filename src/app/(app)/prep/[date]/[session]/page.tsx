import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrepEditorClient } from "@/components/prep/prep-client";
import { isIsoDate } from "@/lib/calendar/dates";
import { loadPrepPage } from "@/lib/data/prep";

export async function generateMetadata({
  params,
}: PageProps<"/prep/[date]/[session]">): Promise<Metadata> {
  const { session } = await params;
  return { title: `${session.toUpperCase()} prep` };
}

export default async function PrepPage({ params }: PageProps<"/prep/[date]/[session]">) {
  const { date, session } = await params;
  if (!isIsoDate(date) || (session !== "eu" && session !== "us")) notFound();
  const data = await loadPrepPage(date, session === "eu" ? "EU" : "US");
  // Keyed so switching day/session starts a fresh editor with its own draft.
  return <PrepEditorClient key={`${date}-${session}`} data={data} />;
}
