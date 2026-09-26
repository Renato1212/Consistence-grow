import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <>
      <PageHeader title="Review" />
      <EmptyState
        icon={ClipboardList}
        title="No debriefs yet"
        description="Daily debriefs and weekly reviews arrive in Phase 4, prefilled from the day's trades and preps."
      />
    </>
  );
}
