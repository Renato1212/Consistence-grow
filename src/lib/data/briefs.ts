import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Brief = {
  id: string;
  date: string;
  session: "EU" | "US";
  source: string;
  markdown: string;
  receivedAt: string;
};

const COLS = "id, date, session, source, markdown, received_at";

function toBrief(r: {
  id: string;
  date: string;
  session: string;
  source: string;
  markdown: string;
  received_at: string;
}): Brief {
  return {
    id: r.id,
    date: r.date,
    session: r.session as Brief["session"],
    source: r.source,
    markdown: r.markdown,
    receivedAt: r.received_at,
  };
}

/** Both editions delivered for a Lisbon date. */
export async function loadDayBriefs(date: string): Promise<Partial<Record<"EU" | "US", Brief>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("briefs")
    .select(COLS)
    .eq("date", date)
    .is("deleted_at", null);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.session, toBrief(r)]));
}

export async function loadRecentBriefs(limit = 10): Promise<Omit<Brief, "markdown">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("briefs")
    .select("id, date, session, source, received_at")
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    session: r.session as Brief["session"],
    source: r.source,
    receivedAt: r.received_at,
  }));
}

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function loadTokens(): Promise<ApiToken[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, name, prefix, created_at, last_used_at")
    .is("revoked_at", null)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
  }));
}
