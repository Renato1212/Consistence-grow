import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AdminTag = {
  id: string;
  name: string;
  sort: number;
  archived: boolean;
  trades: number;
};

export type AdminTagGroup = {
  id: string;
  name: string;
  kind: string;
  sort: number;
  tags: AdminTag[];
};

export const TAG_GROUP_KINDS = ["context", "detail", "mistake", "emotion", "custom"] as const;

/** Tag groups with their tags (archived included) and how many trades use each. */
export async function loadTagAdmin(): Promise<AdminTagGroup[]> {
  const supabase = await createClient();
  const [groups, tags, usage] = await Promise.all([
    supabase
      .from("tag_groups")
      .select("id, name, kind, sort")
      .is("deleted_at", null)
      .order("sort")
      .order("name"),
    supabase
      .from("tags")
      .select("id, name, group_id, sort, archived_at")
      .is("deleted_at", null)
      .order("sort")
      .order("name"),
    supabase.rpc("tag_usage"),
  ]);
  for (const r of [groups, tags, usage]) if (r.error) throw r.error;
  const counts = new Map((usage.data ?? []).map((u) => [u.tag_id, Number(u.trades)]));
  return (groups.data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    sort: g.sort,
    tags: (tags.data ?? [])
      .filter((t) => t.group_id === g.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        sort: t.sort,
        archived: t.archived_at !== null,
        trades: counts.get(t.id) ?? 0,
      })),
  }));
}

export type AdminRule = {
  id: string;
  text: string;
  category: string;
  active: boolean;
  sort: number;
};

export async function loadRuleAdmin(): Promise<AdminRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .select("id, text, category, active, sort")
    .is("deleted_at", null)
    .order("sort")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}
