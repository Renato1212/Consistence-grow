import type { Metadata } from "next";
import { NotebookPen } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  return (
    <>
      <PageHeader title="Journal" />
      <EmptyState
        icon={NotebookPen}
        title="No trades yet"
        description="Taken, missed and observed trades will be listed here. Trade logging arrives in Phase 2."
      />
    </>
  );
}
