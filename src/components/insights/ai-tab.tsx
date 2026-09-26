"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { InsightView } from "@/components/ai/finding-card";
import { isStale, queueAnalysis } from "@/components/ai/queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { specHash, type AiTrade } from "@/lib/ai/payload";
import { filterRequest } from "@/lib/ai/requests";
import { AI_SCHEDULE_TEXT, AI_STALE_HOURS } from "@/lib/ai/schedule";
import { logClientError } from "@/lib/client-errors";
import { useNow } from "@/lib/hooks/use-now";
import type { AiInsight, AiPlaybookOption, AiRequest } from "@/lib/data/ai";
import type { Filter } from "@/lib/insights/filters";
import type { InsightTrade } from "@/lib/insights/types";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { Section, useDrill } from "./bits";

const SCOPE_LABEL: Record<AiInsight["scope"], string> = {
  filter: "Filter",
  session: "Pre-session",
  weekly: "Weekly",
};

export function AiTab({
  filter,
  today,
  trades,
  insights,
  requests: initialRequests,
  playbooks,
  hasToken,
}: {
  filter: Filter;
  today: string;
  trades: InsightTrade[];
  insights: AiInsight[];
  requests: AiRequest[];
  playbooks: AiPlaybookOption[];
  hasToken: boolean;
}) {
  const drill = useDrill();
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);

  const spec = filterRequest(filter);
  const hash = specHash(
    { trades: trades as AiTrade[], debriefs: [], weekly_reviews: [], rule_checks: [] },
    spec,
    today,
  );
  const latest = insights.find((i) => i.scope === "filter" && i.filterKey === spec.filterKey);
  const upToDate = latest?.dataHash === hash;
  const open = requests.find(
    (r) =>
      r.kind === "filter" &&
      r.filterKey === spec.filterKey &&
      (r.status === "pending" || r.status === "served"),
  );
  const failed = requests.find(
    (r) =>
      r.kind === "filter" &&
      r.filterKey === spec.filterKey &&
      r.status === "failed" &&
      (!latest || r.createdAt > latest.createdAt),
  );

  async function queue() {
    setBusy(true);
    try {
      const r = await queueAnalysis(spec);
      setRequests((all) => [r, ...all.filter((x) => x.id !== r.id)]);
      toast.success("Queued for Claude");
    } catch (e) {
      logClientError("ai.queue", e);
      toast.error("Not queued — retry.");
    } finally {
      setBusy(false);
    }
  }

  const history = insights.filter((i) => i.id !== latest?.id);

  return (
    <div className="space-y-4">
      {!hasToken && (
        <p
          className="border-primary/40 rounded-lg border border-dashed p-3 text-sm"
          data-testid="ai-setup"
        >
          Claude analyses run on your Claude subscription through a scheduled Claude Code routine —
          no API credits. To switch it on, create a token with the <strong>AI analysis</strong>{" "}
          scope in{" "}
          <Link href="/settings/integrations" className="text-primary underline">
            Settings → Integrations
          </Link>
          .
        </p>
      )}

      <Section
        title="Claude analysis of this filter"
        description={spec.label}
        aside={
          upToDate && !open ? (
            <Button variant="ghost" size="sm" onClick={queue} disabled={busy}>
              <RefreshCw aria-hidden /> Re-run
            </Button>
          ) : !open ? (
            <Button onClick={queue} disabled={busy || trades.length === 0} data-testid="ai-queue">
              <Sparkles aria-hidden /> Analyse current filter
            </Button>
          ) : null
        }
      >
        {open && (
          <div
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            data-testid="ai-queued"
          >
            <Clock className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">
                {now && isStale(open, AI_STALE_HOURS, now)
                  ? "Not processed yet — check the routine is set up, or run it now."
                  : `Queued ${formatInTz(open.createdAt, DISPLAY_TZ, "EEE HH:mm")}`}
              </div>
              <div className="text-muted-foreground text-xs">{AI_SCHEDULE_TEXT}</div>
            </div>
          </div>
        )}
        {failed && !open && (
          <p className="text-muted-foreground text-sm">Last request: {failed.error ?? "failed"}.</p>
        )}
        {latest ? (
          <>
            {!upToDate && (
              <Badge variant="warn" data-testid="ai-outdated">
                Trades changed since this analysis
              </Badge>
            )}
            <InsightView insight={latest} playbooks={playbooks} onEvidence={drill} />
          </>
        ) : (
          !open && (
            <p className="text-muted-foreground text-sm">
              No analysis of this filter yet. Claude reads the same numbers you see here (with n and
              confidence intervals), the pattern finder and up to 100 trades&apos; notes, and
              returns findings to test.
            </p>
          )
        )}
      </Section>

      <Section
        title="Recent analyses"
        description="Pre-session, weekly and filter analyses, newest first."
      >
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : (
          <ul className="space-y-2" data-testid="ai-history">
            {history.map((i) => (
              <li key={i.id}>
                <details className="rounded-lg border">
                  <summary className="hover:bg-muted/50 flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <Badge variant="outline">{SCOPE_LABEL[i.scope]}</Badge>
                    <span className="flex-1">{i.label}</span>
                    <span className="text-muted-foreground num text-xs">
                      {formatInTz(i.createdAt, DISPLAY_TZ, "EEE d MMM HH:mm")}
                    </span>
                  </summary>
                  <div className="border-t p-3">
                    <InsightView insight={i} playbooks={playbooks} onEvidence={drill} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
