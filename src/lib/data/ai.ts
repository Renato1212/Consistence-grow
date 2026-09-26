import "server-only";

import { outputSchema, type AnalysisOutput } from "@/lib/ai/schema";
import { createClient } from "@/lib/supabase/server";

export type AiInsight = {
  id: string;
  createdAt: string;
  scope: "filter" | "weekly" | "session";
  label: string;
  filterKey: string | null;
  week: string | null;
  dataHash: string;
  model: string;
  output: AnalysisOutput;
};

export type AiRequest = {
  id: string;
  createdAt: string;
  kind: "filter" | "weekly" | "session";
  label: string;
  filterKey: string;
  week: string | null;
  status: "pending" | "served" | "done" | "failed";
  error: string | null;
};

const INSIGHT_COLS = "id, created_at, scope, label, filter_key, week, data_hash, model, output";

type InsightRow = {
  id: string;
  created_at: string;
  scope: string;
  label: string | null;
  filter_key: string | null;
  week: string | null;
  data_hash: string;
  model: string;
  output: unknown;
};

function toInsight(r: InsightRow): AiInsight | null {
  const parsed = outputSchema.safeParse(r.output);
  if (!parsed.success) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    scope: r.scope as AiInsight["scope"],
    label: r.label ?? "Analysis",
    filterKey: r.filter_key,
    week: r.week,
    dataHash: r.data_hash,
    model: r.model,
    output: parsed.data,
  };
}

export async function loadAiInsights(
  opts: { limit?: number; week?: string; scope?: AiInsight["scope"] } = {},
) {
  const supabase = await createClient();
  let q = supabase
    .from("ai_insights")
    .select(INSIGHT_COLS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.week) q = q.eq("week", opts.week);
  if (opts.scope) q = q.eq("scope", opts.scope);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => toInsight(r as InsightRow)).filter((i): i is AiInsight => !!i);
}

/** Open requests plus those that failed in the last week. */
export async function loadAiRequests(): Promise<AiRequest[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("ai_requests")
    .select("id, created_at, kind, label, filter_key, week, status, error")
    .is("deleted_at", null)
    .or(`status.in.(pending,served),and(status.eq.failed,created_at.gte.${since})`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind as AiRequest["kind"],
    label: r.label,
    filterKey: r.filter_key,
    week: r.week,
    status: r.status as AiRequest["status"],
    error: r.error,
  }));
}

/** Whether an active token with the "ai" scope exists (the routine can run). */
export async function hasAiToken(): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("api_tokens")
    .select("id", { count: "exact", head: true })
    .contains("scopes", ["ai"])
    .is("revoked_at", null)
    .is("deleted_at", null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export type AiPlaybookOption = { id: string; name: string };

export async function loadPlaybookOptions(): Promise<AiPlaybookOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playbooks")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
