import type { Metadata } from "next";
import Link from "next/link";

import { RoutineEditor } from "@/components/settings/routine-editor";
import { PageHeader } from "@/components/shell/empty-state";
import { addDays, isWeekend } from "@/lib/calendar/dates";
import { loadEditorData } from "@/lib/data/editor";
import { loadRoutine } from "@/lib/data/routine";
import { defaultRoutine } from "@/lib/routine/routine";
import { lisbonToday } from "@/lib/time";

export const metadata: Metadata = { title: "Daily routine" };

export default async function RoutineSettingsPage() {
  const [{ routine, setups }, editor] = await Promise.all([loadRoutine(), loadEditorData()]);
  const fallback = defaultRoutine(
    Object.fromEntries(Object.entries(setups).map(([k, s]) => [k, s.id])),
  );
  let sample = lisbonToday();
  while (isWeekend(sample)) sample = addDays(sample, 1);
  return (
    <>
      <PageHeader title="Daily routine">
        <Link href="/today" className="text-primary-ink text-sm hover:underline">
          See it on Today →
        </Link>
      </PageHeader>
      <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
        Your blocks for each trading day. Enter times in the market&apos;s own time zone (London for
        the EU session, New York for the US): the Lisbon times then move by themselves on the weeks
        when only one side has changed its clocks.
      </p>
      <RoutineEditor
        initial={routine}
        fallback={fallback}
        setups={editor.playbooks.map((p) => ({ id: p.id, name: p.name }))}
        sampleDate={sample}
      />
    </>
  );
}
