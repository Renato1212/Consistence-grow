import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { backupJson, storeBackup } from "@/lib/export/build";
import { lisbonToday } from "@/lib/time";

/**
 * GET /api/cron/backup — Vercel Cron, Sundays 03:00 UTC (vercel.json).
 * For every user: store a JSON backup in backups/<user>/<date>.json (keeps 12),
 * then hard-delete trash older than 30 days and its media files.
 * Needs CRON_SECRET (sent by Vercel as a Bearer token) and SUPABASE_SECRET_KEY.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !key) {
    return NextResponse.json(
      { ok: false, error: "Not configured: set CRON_SECRET and SUPABASE_SECRET_KEY" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (users.error) {
    console.error("[cron.backup] listUsers", users.error.message);
    return NextResponse.json({ ok: false, error: "Could not list users" }, { status: 500 });
  }

  const date = lisbonToday();
  const results = [];
  for (const u of users.data.users) {
    try {
      const stored = await storeBackup(admin, u.id, await backupJson(admin, u.id), date);
      const purge = await admin.rpc("purge_trash", { p_user: u.id });
      if (purge.error) throw purge.error;
      const { media_paths: paths, counts } = purge.data as {
        media_paths: string[];
        counts: unknown;
      };
      for (let i = 0; i < paths.length; i += 100) {
        await admin.storage.from("media").remove(paths.slice(i, i + 100));
      }
      results.push({ user: u.id, ok: true, backup: stored, purged: counts });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron.backup]", u.id, message);
      await admin.from("error_logs").insert({ user_id: u.id, source: "cron.backup", message });
      results.push({ user: u.id, ok: false, error: message });
    }
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, date, results }, { status: ok ? 200 : 500 });
}
