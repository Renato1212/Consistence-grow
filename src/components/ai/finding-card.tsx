"use client";

import { useState } from "react";
import Link from "next/link";
import { BookPlus, Check, ListChecks, ListPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Finding } from "@/lib/ai/schema";
import { logClientError } from "@/lib/client-errors";
import type { AiInsight, AiPlaybookOption } from "@/lib/data/ai";
import { domainLabel } from "@/lib/domains";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<Finding["type"], string> = {
  strength: "Strength",
  leak: "Leak",
  process: "Process",
  plan: "Plan",
  risk: "Risk",
};

const CONFIDENCE_CLASS: Record<Finding["confidence"], string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-primary-ink",
};

function noteText(insight: AiInsight, f: Finding) {
  const when = formatInTz(insight.createdAt, DISPLAY_TZ, "d MMM yyyy");
  return `**AI finding (${when}) — ${f.title}**\n${f.observation}\n\n_Experiment:_ ${f.suggested_experiment} (n=${f.sample_size}, ${f.confidence} confidence — hypothesis to test)`;
}

export function FindingCard({
  insight,
  finding: f,
  playbooks,
  onEvidence,
  compact = false,
}: {
  insight: AiInsight;
  finding: Finding;
  playbooks: AiPlaybookOption[];
  onEvidence?: (title: string, ids: string[]) => void;
  compact?: boolean;
}) {
  const [actionAdded, setActionAdded] = useState(false);
  const [notedTo, setNotedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const related = playbooks.find((p) => p.id === f.related_playbook_id);

  async function addAction() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("action_items")
      .insert({
        source: "ai",
        source_id: insight.id,
        text: `${f.title}: ${f.suggested_experiment}`.slice(0, 500),
        show_in_prep: true,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      logClientError("ai.action_item", error, { insight: insight.id });
      toast.error("Action item not created — retry.");
      return;
    }
    setActionAdded(true);
    toast("Action item added — it shows on Today and in your preps", {
      action: {
        label: "Undo",
        onClick: async () => {
          const res = await supabase
            .from("action_items")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", data.id);
          if (res.error) toast.error("Undo failed — retry.");
          else setActionAdded(false);
        },
      },
    });
  }

  async function addNote(playbookId: string) {
    const name = playbooks.find((p) => p.id === playbookId)?.name ?? "playbook";
    setBusy(true);
    const { data, error } = await createClient().rpc("append_playbook_note", {
      p_playbook: playbookId,
      p_text: noteText(insight, f),
    });
    setBusy(false);
    if (error || !data) {
      logClientError("ai.playbook_note", error, { insight: insight.id, playbook: playbookId });
      toast.error("Note not added — retry.");
      return;
    }
    setNotedTo(name);
    toast.success(`Added to the notes of “${name}”`);
  }

  return (
    <article className="space-y-2 rounded-lg border p-3" data-testid="ai-finding">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{f.title}</h3>
        <Badge variant="outline">{TYPE_LABEL[f.type]}</Badge>
        {f.domain && <Badge variant="outline">{domainLabel(f.domain)}</Badge>}
        <span className={cn("num ml-auto text-xs", CONFIDENCE_CLASS[f.confidence])}>
          {f.confidence} confidence · n={f.sample_size}
        </span>
      </div>
      <p className="text-sm">{f.observation}</p>
      {!compact && (
        <p className="bg-muted/50 rounded-md px-2.5 py-1.5 text-sm">
          <span className="text-primary-ink text-xs font-semibold uppercase">Experiment </span>
          {f.suggested_experiment}
        </p>
      )}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          {f.evidence_trade_ids.length > 0 &&
            (onEvidence ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEvidence(f.title, f.evidence_trade_ids)}
              >
                <ListChecks aria-hidden />
                {f.evidence_trade_ids.length} evidence trade
                {f.evidence_trade_ids.length === 1 ? "" : "s"}
              </Button>
            ) : (
              <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                Evidence:
                {f.evidence_trade_ids.map((id, i) => (
                  <Link key={id} href={`/journal?trade=${id}`} className="underline">
                    #{i + 1}
                  </Link>
                ))}
              </span>
            ))}
          <Button variant="outline" size="sm" disabled={busy || actionAdded} onClick={addAction}>
            {actionAdded ? <Check aria-hidden /> : <ListPlus aria-hidden />}
            {actionAdded ? "Action item added" : "Create action item"}
          </Button>
          {notedTo ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Check className="size-3.5" aria-hidden /> Noted in {notedTo}
            </span>
          ) : related ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => addNote(related.id)}>
              <BookPlus aria-hidden />
              Add note to {related.name}
            </Button>
          ) : (
            playbooks.length > 0 && (
              <NativeSelect
                aria-label="Add note to playbook"
                className="h-8 w-52 text-xs"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && addNote(e.target.value)}
              >
                <option value="">Add note to playbook…</option>
                {playbooks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            )
          )}
        </div>
      )}
    </article>
  );
}

/** Summary + findings of one analysis, labelled as hypotheses. */
export function InsightView({
  insight,
  playbooks,
  onEvidence,
  compact = false,
  limit,
}: {
  insight: AiInsight;
  playbooks: AiPlaybookOption[];
  onEvidence?: (title: string, ids: string[]) => void;
  compact?: boolean;
  limit?: number;
}) {
  const findings = limit ? insight.output.findings.slice(0, limit) : insight.output.findings;
  return (
    <div className="space-y-3" data-testid="ai-insight">
      <p className="text-sm">{insight.output.summary}</p>
      <div className="space-y-2">
        {findings.map((f, i) => (
          <FindingCard
            key={i}
            insight={insight}
            finding={f}
            playbooks={playbooks}
            onEvidence={onEvidence}
            compact={compact}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {insight.label} · {formatInTz(insight.createdAt, DISPLAY_TZ, "EEE d MMM HH:mm")} ·{" "}
        {insight.model} · hypotheses to test, not confirmed edges
      </p>
    </div>
  );
}
