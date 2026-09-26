import type { Metadata } from "next";
import { BookOpenText } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { DOMAINS } from "@/lib/domains";
import { logServerError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Playbook" };

const STATUS_LABEL: Record<string, string> = {
  idea: "Idea",
  testing: "Testing",
  active: "Active",
  retired: "Retired",
};

export default async function PlaybookPage() {
  const supabase = await createClient();
  const { data: playbooks, error } = await supabase
    .from("playbooks")
    .select("id, name, primary_domain, status, summary")
    .is("deleted_at", null)
    .order("created_at");

  if (error) await logServerError("playbook.list", error);

  return (
    <>
      <PageHeader title="Playbook" />
      {error ? (
        <p role="alert" className="text-muted-foreground text-sm">
          Something failed loading playbooks. Reload to retry.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          {DOMAINS.map((d) => {
            const items = (playbooks ?? []).filter((p) => p.primary_domain === d.code);
            return (
              <section key={d.code} aria-labelledby={`domain-${d.code}`} className="min-w-0">
                <h2
                  id={`domain-${d.code}`}
                  className="heading-caps mb-3 flex items-center gap-2 text-[11px]"
                >
                  <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
                  {d.short}
                  <span className="text-muted-foreground num">{items.length}</span>
                </h2>
                <ul className="space-y-2">
                  {items.map((p) => (
                    <li key={p.id} className="bg-card rounded-md border p-3">
                      <p className="text-sm leading-snug font-medium">{p.name}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {STATUS_LABEL[p.status] ?? p.status}
                      </p>
                    </li>
                  ))}
                  {items.length === 0 && (
                    <li className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                      No playbooks
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <div className="mt-8">
        <EmptyState
          icon={BookOpenText}
          title="Editing, versions and live stats arrive in Phase 5"
          description="Your draft playbooks are saved. The full template, pre-entry checklist, version history and stats from linked trades come with the Playbook phase."
        />
      </div>
    </>
  );
}
