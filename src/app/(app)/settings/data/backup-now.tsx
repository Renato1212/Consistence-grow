"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function BackupNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Backup stored");
      router.refresh();
    } catch {
      toast.error("Backup failed — retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={busy} data-testid="backup-now">
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <DatabaseBackup aria-hidden />}
      Back up now
    </Button>
  );
}
