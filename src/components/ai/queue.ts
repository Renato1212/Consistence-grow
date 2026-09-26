"use client";

import type { RequestSpec } from "@/lib/ai/requests";
import type { AiRequest } from "@/lib/data/ai";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";

/** Queue an analysis for the routine (re-uses an open request for the same filter and week). */
export async function queueAnalysis(spec: RequestSpec): Promise<AiRequest> {
  const supabase = createClient();
  let open = supabase
    .from("ai_requests")
    .select("id, created_at, kind, label, filter_key, week, status, error")
    .is("deleted_at", null)
    .in("status", ["pending", "served"])
    .eq("kind", spec.kind)
    .eq("filter_key", spec.filterKey);
  open = spec.week ? open.eq("week", spec.week) : open.is("week", null);
  const existing = await open.limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  let row = existing.data;
  if (!row) {
    const ins = await supabase
      .from("ai_requests")
      .insert({
        kind: spec.kind,
        slot: spec.slot,
        label: spec.label,
        filter: spec.filter as unknown as { [key: string]: Json },
        filter_key: spec.filterKey,
        week: spec.week,
      })
      .select("id, created_at, kind, label, filter_key, week, status, error")
      .single();
    if (ins.error) throw ins.error;
    row = ins.data;
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind as AiRequest["kind"],
    label: row.label,
    filterKey: row.filter_key,
    week: row.week,
    status: row.status as AiRequest["status"],
    error: row.error,
  };
}

export function isStale(r: AiRequest, hours: number, now: number): boolean {
  return (
    (r.status === "pending" || r.status === "served") &&
    now - Date.parse(r.createdAt) > hours * 3_600_000
  );
}
