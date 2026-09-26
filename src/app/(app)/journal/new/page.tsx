import type { Metadata } from "next";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Log trade" };

export default function NewTradePage() {
  return (
    <>
      <PageHeader title="Log trade" />
      <EmptyState
        icon={Plus}
        title="Trade logging arrives in Phase 2"
        description="The quick form (instrument, direction, entry, exit, size, domain — under 60 seconds) with autosave and screenshot paste will live here."
      />
    </>
  );
}
