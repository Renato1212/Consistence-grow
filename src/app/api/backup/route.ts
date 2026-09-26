import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerError } from "@/lib/errors";
import { backupJson, storeBackup } from "@/lib/export/build";
import { createClient } from "@/lib/supabase/server";
import { lisbonToday } from "@/lib/time";

/** POST /api/backup — "Back up now": store today's backup in the private bucket as the signed-in user. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, error: "Sign in first" }, { status: 401 });
  try {
    const json = await backupJson(supabase, data.user.id);
    const stored = await storeBackup(supabase, data.user.id, json, lisbonToday());
    return NextResponse.json({ ok: true, ...stored });
  } catch (e) {
    await logServerError("backup.manual", e);
    return NextResponse.json({ ok: false, error: "Backup failed — retry" }, { status: 500 });
  }
}
