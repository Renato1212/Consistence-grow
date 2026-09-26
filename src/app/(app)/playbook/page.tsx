import type { Metadata } from "next";
import { BookOpenText } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { DOMAINS } from "@/lib/domains";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Playbook" };

export default function PlaybookPage() {
  return (
    <>
      <PageHeader title="Playbook" />
      <ul className="mb-6 flex flex-wrap gap-2" aria-label="Edge domains">
        {DOMAINS.map((d) => (
          <li
            key={d.code}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
          >
            <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
            {d.label}
          </li>
        ))}
      </ul>
      <EmptyState
        icon={BookOpenText}
        title="No playbooks yet"
        description="Playbooks organised by the five edge domains, with versioning and live stats, arrive in Phase 5."
      />
    </>
  );
}
