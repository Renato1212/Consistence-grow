import "server-only";

import type { DomainCode } from "@/lib/domains";
import { createClient } from "@/lib/supabase/server";
import type { FormInstrument } from "@/lib/trading/trade-form";
import type { PriceFormat } from "@/lib/trading/instrument-specs";

export type EditorInstrument = FormInstrument & {
  name: string;
  active: boolean;
  sortOrder: number;
};
export type EditorPlaybook = {
  id: string;
  name: string;
  primaryDomain: DomainCode;
  status: string;
};
export type EditorTagGroup = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  /** Archived tags only show when a trade already carries them. */
  tags: { id: string; name: string; archived: boolean }[];
};

export type EditorData = {
  instruments: EditorInstrument[];
  lastInstrumentId: string | null;
  playbooks: EditorPlaybook[];
  tagGroups: EditorTagGroup[];
};

/** Everything the trade form needs, loaded in parallel. Throws on failure. */
export async function loadEditorData(): Promise<EditorData> {
  const supabase = await createClient();
  const [inst, settings, pbs, groups, tags] = await Promise.all([
    supabase
      .from("instruments")
      .select(
        "id, symbol, name, tick_size, tick_value, fee_per_contract, exchange_tz, price_format, currency, active, sort_order",
      )
      .is("deleted_at", null)
      .order("sort_order"),
    supabase.from("user_settings").select("last_instrument_id").maybeSingle(),
    supabase
      .from("playbooks")
      .select("id, name, primary_domain, status")
      .is("deleted_at", null)
      .neq("status", "retired")
      .order("name"),
    supabase
      .from("tag_groups")
      .select("id, name, kind, color, sort")
      .is("deleted_at", null)
      .order("sort"),
    supabase
      .from("tags")
      .select("id, name, group_id, sort, archived_at")
      .is("deleted_at", null)
      .order("sort"),
  ]);
  for (const r of [inst, settings, pbs, groups, tags]) if (r.error) throw r.error;

  return {
    instruments: (inst.data ?? []).map((i) => ({
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      tickSize: Number(i.tick_size),
      tickValue: Number(i.tick_value),
      feePerContract: Number(i.fee_per_contract),
      exchangeTz: i.exchange_tz,
      priceFormat: i.price_format as PriceFormat,
      currency: i.currency,
      active: i.active,
      sortOrder: i.sort_order,
    })),
    lastInstrumentId: settings.data?.last_instrument_id ?? null,
    playbooks: (pbs.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      primaryDomain: p.primary_domain as DomainCode,
      status: p.status,
    })),
    tagGroups: (groups.data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      color: g.color,
      tags: (tags.data ?? [])
        .filter((t) => t.group_id === g.id)
        .map((t) => ({ id: t.id, name: t.name, archived: t.archived_at !== null })),
    })),
  };
}
