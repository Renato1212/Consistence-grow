import type { Metadata } from "next";
import { CalendarCheck2 } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <>
      <PageHeader title="Today" />
      <EmptyState
        icon={CalendarCheck2}
        title="Your session workspace is being built"
        description="EU/US preparation, today's events with countdowns, the be-flat banner and debrief prompts arrive in Phase 3. For now, press N to open the trade log."
      />
    </>
  );
}
