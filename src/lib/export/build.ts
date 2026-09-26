import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";

import { fetchAll } from "@/lib/data/paginate";
import { toCsv } from "./csv";
import { EXCLUDED_COLUMNS, EXPORT_TABLES, EXPORT_VERSION, type ExportTable } from "./tables";

const LIMIT = 200_000;

export type ExportData = {
  version: number;
  exported_at: string;
  user_id: string;
  tables: Record<ExportTable, Record<string, unknown>[]>;
};

/**
 * Every row of every user table for `userId`. Works with the signed-in client
 * (RLS) and with the service client (the explicit user filter scopes it).
 */
export async function collectExport(supabase: SupabaseClient, userId: string): Promise<ExportData> {
  const tables = {} as ExportData["tables"];
  for (const table of EXPORT_TABLES) {
    const orderBy = table === "trade_tags" ? "trade_id" : "id";
    const { rows } = await fetchAll(
      (from, to) =>
        supabase.from(table).select("*").eq("user_id", userId).order(orderBy).range(from, to),
      LIMIT,
    );
    const drop = EXCLUDED_COLUMNS[table] ?? [];
    tables[table] = (rows as Record<string, unknown>[]).map((r) => {
      if (!drop.length) return r;
      const copy = { ...r };
      for (const c of drop) delete copy[c];
      return copy;
    });
  }
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user_id: userId,
    tables,
  };
}

/** Signed links (7 days) for every stored media file, for the export's media list. */
export async function mediaLinks(supabase: SupabaseClient, media: Record<string, unknown>[]) {
  const paths = media
    .map((m) => m.storage_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await supabase.storage
      .from("media")
      .createSignedUrls(paths.slice(i, i + 100), 7 * 24 * 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return media.map((m) => ({
    id: m.id,
    owner_type: m.owner_type,
    owner_id: m.owner_id,
    kind: m.kind,
    caption: m.caption,
    storage_path: m.storage_path,
    link: m.kind === "link" ? m.url : (urls.get(String(m.storage_path)) ?? null),
    deleted_at: m.deleted_at,
  }));
}

/** Zip: all tables as one JSON, a CSV per table, and media links (JSON + CSV). */
export function exportZip(data: ExportData, links: Record<string, unknown>[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "consistent-grow.json": strToU8(JSON.stringify(data, null, 1)),
    "media-links.json": strToU8(JSON.stringify(links, null, 1)),
    "media-links.csv": strToU8(toCsv(links)),
    "README.txt": strToU8(
      `Consistent Grow export (v${data.version}) — ${data.exported_at}\n\n` +
        "consistent-grow.json  every table, every row (including items in the trash)\n" +
        "csv/<table>.csv       the same data, one CSV per table\n" +
        "media-links.*         your screenshots/videos with download links valid for 7 days\n",
    ),
  };
  for (const [table, rows] of Object.entries(data.tables)) {
    files[`csv/${table}.csv`] = strToU8(toCsv(rows));
  }
  return zipSync(files, { level: 6 });
}

export async function backupJson(supabase: SupabaseClient, userId: string): Promise<string> {
  return JSON.stringify(await collectExport(supabase, userId));
}

export const BACKUP_KEEP = 12;

/** Upload `backups/<user>/<date>.json` and keep the newest BACKUP_KEEP files. */
export async function storeBackup(
  supabase: SupabaseClient,
  userId: string,
  json: string,
  date: string,
) {
  const path = `${userId}/${date}.json`;
  const up = await supabase.storage
    .from("backups")
    .upload(path, new Blob([json], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });
  if (up.error) throw up.error;
  const list = await supabase.storage
    .from("backups")
    .list(userId, { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (list.error) throw list.error;
  const old = (list.data ?? [])
    .filter((f) => f.name.endsWith(".json"))
    .slice(BACKUP_KEEP)
    .map((f) => `${userId}/${f.name}`);
  if (old.length) await supabase.storage.from("backups").remove(old);
  return { path, bytes: json.length, pruned: old.length };
}
