import Link from "next/link";
import { Sparkles } from "lucide-react";

import { InsightView } from "@/components/ai/finding-card";
import type { AiInsight, AiPlaybookOption } from "@/lib/data/ai";

/** Today: Claude's pre-session notes for the session at hand (top findings). */
export function AiNotes({
  insight,
  playbooks,
}: {
  insight: AiInsight;
  playbooks: AiPlaybookOption[];
}) {
  return (
    <section
      className="bg-card space-y-3 rounded-xl border p-4"
      aria-label="Claude pre-session notes"
      data-testid="ai-notes"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="heading-caps inline-flex items-center gap-1.5 text-xs">
          <Sparkles className="text-primary-ink size-3.5" aria-hidden />
          Claude · pre-session notes
        </h2>
        <Link href="/insights?tab=ai" className="text-primary-ink text-xs hover:underline">
          All analyses
        </Link>
      </div>
      <InsightView insight={insight} playbooks={playbooks} compact limit={3} />
    </section>
  );
}
