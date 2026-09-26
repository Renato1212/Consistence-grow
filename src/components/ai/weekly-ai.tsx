"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { weeklyRequest } from "@/lib/ai/requests";
import { AI_SCHEDULE_TEXT } from "@/lib/ai/schedule";
import { logClientError } from "@/lib/client-errors";
import type { AiInsight, AiPlaybookOption, AiRequest } from "@/lib/data/ai";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { InsightView } from "./finding-card";
import { queueAnalysis } from "./queue";

/** Claude's weekly review of one ISO week (runs on the owner's subscription via the routine). */
export function WeeklyAi({
  week,
  insight,
  request: initialRequest,
  playbooks,
  hasToken,
}: {
  week: string;
  insight: AiInsight | null;
  request: AiRequest | null;
  playbooks: AiPlaybookOption[];
  hasToken: boolean;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [busy, setBusy] = useState(false);
  const spec = weeklyRequest(week);
  const open = request && (request.status === "pending" || request.status === "served");

  async function queue() {
    if (!spec) return;
    setBusy(true);
    try {
      setRequest(await queueAnalysis(spec));
      toast.success("Queued for Claude");
    } catch (e) {
      logClientError("ai.queue_weekly", e, { week });
      toast.error("Not queued — retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="bg-card space-y-3 rounded-xl border p-4"
      aria-label="Claude weekly review"
      data-testid="weekly-ai"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="heading-caps text-xs">Claude weekly review</h2>
        {!open &&
          (insight ? (
            <Button variant="ghost" size="sm" onClick={queue} disabled={busy}>
              <RefreshCw aria-hidden /> Re-run
            </Button>
          ) : (
            <Button size="sm" onClick={queue} disabled={busy}>
              <Sparkles aria-hidden /> Ask Claude for this week&apos;s review
            </Button>
          ))}
      </div>
      {open && (
        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          data-testid="ai-queued"
        >
          <Clock className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">
              Queued {formatInTz(request!.createdAt, DISPLAY_TZ, "EEE HH:mm")}
            </div>
            <div className="text-muted-foreground text-xs">{AI_SCHEDULE_TEXT}</div>
          </div>
        </div>
      )}
      {!hasToken && (
        <p className="text-muted-foreground text-xs">
          Needs the analysis routine: create an <strong>AI analysis</strong> token in{" "}
          <Link href="/settings/integrations" className="text-primary underline">
            Settings → Integrations
          </Link>
          .
        </p>
      )}
      {insight ? (
        <InsightView insight={insight} playbooks={playbooks} />
      ) : (
        !open && (
          <p className="text-muted-foreground text-sm">
            The Saturday 09:10 run reviews the week automatically: trades, debriefs, rule checks,
            your reflection and goals.
          </p>
        )
      )}
    </section>
  );
}
