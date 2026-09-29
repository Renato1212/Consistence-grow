"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { planRestore, type RestorePlan } from "@/lib/export/restore";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";

/**
 * Restore from a backup or export JSON: puts back rows that are missing
 * (e.g. after the 30-day purge or an accident). Rows that exist are never
 * touched, so restoring twice is harmless.
 */
export function RestoreBackup() {
  const router = useRouter();
  const [plan, setPlan] = useState<(RestorePlan & { ok: true }) | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setPlan(null);
    if (!file) return;
    setName(file.name);
    const p = planRestore(await file.text());
    if (!p.ok) {
      toast.error(p.error);
      return;
    }
    setPlan(p);
  }

  async function restore() {
    if (!plan) return;
    setBusy(true);
    const supabase = createClient();
    const restored: Record<string, number> = {};
    try {
      for (const step of plan.steps) {
        const r = await supabase.rpc("restore_rows", {
          p_table: step.table,
          p_rows: step.rows as unknown as Json,
        });
        if (r.error) throw r.error;
        restored[step.table] = (restored[step.table] ?? 0) + Number(r.data ?? 0);
      }
      setResult(restored);
      const n = Object.values(restored).reduce((a, b) => a + b, 0);
      toast.success(n ? `${n} missing rows restored` : "Nothing was missing");
      router.refresh();
    } catch (e) {
      logClientError("restore.backup", e);
      setResult(restored);
      toast.error("Restore stopped — retry (already restored rows are kept).");
    } finally {
      setBusy(false);
    }
  }

  const counts = plan
    ? Object.entries(
        plan.steps.reduce<Record<string, number>>((acc, s) => {
          acc[s.table] = (acc[s.table] ?? 0) + s.rows.length;
          return acc;
        }, {}),
      )
    : [];

  return (
    <div className="grid gap-3" data-testid="restore-backup">
      <label className="hover:bg-accent inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
        <FileUp className="size-4" aria-hidden />
        {name ?? "Choose backup file (.json)"}
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Backup file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {plan && (
        <>
          <p className="text-muted-foreground text-xs" data-testid="restore-summary">
            {plan.total.toLocaleString("en-US")} rows in {counts.length} tables
            {plan.exportedAt ? ` · made ${plan.exportedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
            . Only rows that are missing are added back; nothing is overwritten.
          </p>
          <Button onClick={restore} disabled={busy} className="w-fit" data-testid="restore-run">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            Restore missing rows
          </Button>
        </>
      )}
      {result && (
        <ul className="text-muted-foreground grid gap-0.5 text-xs" data-testid="restore-result">
          {Object.entries(result)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => (
              <li key={t}>
                {t}: {n} restored
              </li>
            ))}
          {Object.values(result).every((n) => n === 0) && <li>Nothing was missing.</li>}
        </ul>
      )}
    </div>
  );
}
