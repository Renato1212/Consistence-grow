import "server-only";

import type { MediaItem } from "@/components/trade/media-manager";
import { loadMedia } from "@/lib/data/media";
import type { DomainCode } from "@/lib/domains";
import {
  playbookRowToSnapshot,
  type PlaybookRow,
  type PlaybookSnapshot,
  type PlaybookStatus,
} from "@/lib/playbook/form";
import { exampleOrder, playbookStats, type PlaybookTrade } from "@/lib/playbook/stats";
import { createClient } from "@/lib/supabase/server";
import { FACT_COLUMNS, toFact } from "./debrief";

const PB_TRADE_COLUMNS = `${FACT_COLUMNS}, playbook_id, playbook_version, time_bucket, minutes_from_event, checklist, media_count`;
const PB_COLUMNS =
  "id, name, primary_domain, secondary_domains, markets, status, summary, context_md, edge_md, trigger_md, stop_md, targets_md, avoid_md, notes_md, version, updated_at, deleted_at";

function toPbTrade(r: Record<string, unknown>): PlaybookTrade & { playbook_id: string } {
  return {
    ...toFact(r),
    playbook_id: r.playbook_id as string,
    playbook_version: (r.playbook_version as number | null) ?? null,
    time_bucket: (r.time_bucket as string | null) ?? null,
    minutes_from_event: (r.minutes_from_event as number | null) ?? null,
    checklist: (r.checklist as Record<string, boolean> | null) ?? {},
    media_count: Number(r.media_count ?? 0),
  };
}

async function loadLinkedTrades(playbookIds: string[] | null) {
  const supabase = await createClient();
  let q = supabase
    .from("trade_facts")
    .select(PB_TRADE_COLUMNS)
    .not("playbook_id", "is", null)
    .order("entry_at")
    .limit(10000);
  if (playbookIds) q = q.in("playbook_id", playbookIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => toPbTrade(r as Record<string, unknown>));
}

export type PlaybookCard = {
  id: string;
  name: string;
  primaryDomain: DomainCode;
  status: PlaybookStatus;
  summary: string | null;
  version: number;
  n: number;
  winRate: number | null;
  avgR: number | null;
  rN: number;
  lastTraded: string | null;
};

export async function loadPlaybookList(): Promise<{
  cards: PlaybookCard[];
  deleted: { id: string; name: string; deletedAt: string }[];
}> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [pbs, deleted, trades] = await Promise.all([
    supabase.from("playbooks").select(PB_COLUMNS).is("deleted_at", null).order("created_at"),
    supabase
      .from("playbooks")
      .select("id, name, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", cutoff)
      .order("deleted_at", { ascending: false }),
    loadLinkedTrades(null),
  ]);
  if (pbs.error) throw pbs.error;
  if (deleted.error) throw deleted.error;

  return {
    cards: (pbs.data ?? []).map((p) => {
      const s = playbookStats(trades.filter((t) => t.playbook_id === p.id));
      return {
        id: p.id,
        name: p.name,
        primaryDomain: p.primary_domain as DomainCode,
        status: p.status as PlaybookStatus,
        summary: p.summary,
        version: p.version,
        n: s.n,
        winRate: s.winRate,
        avgR: s.avgR,
        rN: s.rN,
        lastTraded: s.lastTraded,
      };
    }),
    deleted: (deleted.data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      deletedAt: d.deleted_at as string,
    })),
  };
}

export type PlaybookVersion = {
  version: number;
  createdAt: string;
  updatedAt: string;
  snapshot: Record<string, unknown>;
};

export type PlaybookPageData = {
  snapshot: PlaybookSnapshot;
  version: number;
  updatedAt: string;
  deleted: boolean;
  versions: PlaybookVersion[];
  trades: PlaybookTrade[];
  pinned: MediaItem[];
  examples: { trade: PlaybookTrade; media: MediaItem[] }[];
};

export async function loadPlaybookPage(id: string): Promise<PlaybookPageData | null> {
  const supabase = await createClient();
  const [pb, items, versions, trades] = await Promise.all([
    supabase.from("playbooks").select(PB_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("playbook_checklist_items")
      .select("id, text")
      .eq("playbook_id", id)
      .is("deleted_at", null)
      .order("sort")
      .order("created_at"),
    supabase
      .from("playbook_versions")
      .select("version, snapshot, created_at, updated_at")
      .eq("playbook_id", id)
      .is("deleted_at", null)
      .order("version", { ascending: false }),
    loadLinkedTrades([id]),
  ]);
  if (pb.error) throw pb.error;
  if (!pb.data) return null;
  if (items.error) throw items.error;
  if (versions.error) throw versions.error;

  const exampleTrades = exampleOrder(trades).slice(0, 12);
  const [pinned, tradeMedia] = await Promise.all([
    loadMedia("playbook", [id]),
    loadMedia(
      "trade",
      exampleTrades.map((t) => t.id),
    ),
  ]);

  return {
    snapshot: playbookRowToSnapshot(pb.data as unknown as PlaybookRow, items.data ?? []),
    version: pb.data.version,
    updatedAt: pb.data.updated_at,
    deleted: pb.data.deleted_at !== null,
    versions: (versions.data ?? []).map((v) => ({
      version: v.version,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      snapshot: v.snapshot as Record<string, unknown>,
    })),
    trades,
    pinned: pinned[id] ?? [],
    examples: exampleTrades
      .map((trade) => ({ trade, media: tradeMedia[trade.id] ?? [] }))
      .filter((e) => e.media.length > 0),
  };
}
