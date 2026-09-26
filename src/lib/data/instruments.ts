import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Symbols of active instruments in the user's order (for pickers). */
export async function loadActiveSymbols(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruments")
    .select("symbol")
    .is("deleted_at", null)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r) => r.symbol);
}
