import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerError } from "@/lib/errors";
import { collectExport, exportZip, mediaLinks } from "@/lib/export/build";
import { createClient } from "@/lib/supabase/server";
import { lisbonToday } from "@/lib/time";

/** GET /api/export — everything the signed-in user owns, as a zip (JSON + CSV per table + media links). */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new Response("Sign in first", { status: 401 });
  try {
    const exported = await collectExport(supabase, data.user.id);
    const links = await mediaLinks(supabase, exported.tables.media);
    const zip = exportZip(exported, links);
    return new Response(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="consistent-grow-export-${lisbonToday()}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    await logServerError("export.zip", e);
    return new Response("Export failed — retry", { status: 500 });
  }
}
