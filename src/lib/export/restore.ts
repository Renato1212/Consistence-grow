/**
 * Restore plan for a backup/export JSON: the tables in parent-first order
 * (the export order), chunked for the `restore_rows` RPC. API tokens are
 * never restored (their hashes are not in backups).
 */
import { EXPORT_TABLES, type ExportTable } from "./tables";

export const RESTORE_CHUNK = 500;
export const RESTORABLE = EXPORT_TABLES.filter((t) => t !== "api_tokens");

export type RestoreStep = { table: ExportTable; rows: Record<string, unknown>[] };

export type RestorePlan =
  | { ok: true; exportedAt: string | null; steps: RestoreStep[]; total: number }
  | { ok: false; error: string };

export function planRestore(text: string): RestorePlan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const tables = (data as { tables?: unknown })?.tables;
  if (!tables || typeof tables !== "object") {
    return { ok: false, error: "This is not a Consistent Grow backup (no tables)." };
  }
  const steps: RestoreStep[] = [];
  for (const table of RESTORABLE) {
    const rows = (tables as Record<string, unknown>)[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += RESTORE_CHUNK) {
      steps.push({ table, rows: rows.slice(i, i + RESTORE_CHUNK) as Record<string, unknown>[] });
    }
  }
  const exportedAt = (data as { exported_at?: unknown }).exported_at;
  return {
    ok: true,
    exportedAt: typeof exportedAt === "string" ? exportedAt : null,
    steps,
    total: steps.reduce((n, s) => n + s.rows.length, 0),
  };
}
