import "server-only";

import { normalizeMapping } from "@/lib/import/preset";
import type { ImportInstrument, ImportMapping } from "@/lib/import/parse";
import { createClient } from "@/lib/supabase/server";

export type ImportPreset = { id: string; name: string; mapping: ImportMapping };

export async function loadImportSetup(): Promise<{
  instruments: ImportInstrument[];
  presets: ImportPreset[];
}> {
  const supabase = await createClient();
  const [inst, presets] = await Promise.all([
    supabase
      .from("instruments")
      .select("id, symbol, tick_size, price_format")
      .is("deleted_at", null)
      .order("sort_order"),
    supabase
      .from("import_presets")
      .select("id, name, mapping")
      .is("deleted_at", null)
      .order("name"),
  ]);
  if (inst.error) throw inst.error;
  if (presets.error) throw presets.error;
  return {
    instruments: (inst.data ?? []).map((i) => ({
      id: i.id,
      symbol: i.symbol,
      tickSize: Number(i.tick_size),
      priceFormat: i.price_format as ImportInstrument["priceFormat"],
    })),
    presets: (presets.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      mapping: normalizeMapping(p.mapping),
    })),
  };
}

/** Taken trades still flagged for review (imported, no domain yet). */
export async function countNeedsReview(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("needs_review", true)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
