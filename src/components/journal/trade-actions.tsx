"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";

async function setDeleted(id: string, deleted: boolean) {
  return createClient()
    .from("trades")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", id);
}

/** Soft delete with an Undo toast. */
export function DeleteTradeButton({ id, afterDelete }: { id: string; afterDelete?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      className="text-muted-foreground"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await setDeleted(id, true);
        setBusy(false);
        if (error) {
          logClientError("trade.delete", error, { id });
          toast.error("Something failed, retry.");
          return;
        }
        toast("Trade moved to trash", {
          action: {
            label: "Undo",
            onClick: async () => {
              const r = await setDeleted(id, false);
              if (r.error) toast.error("Could not restore — find it in Trash.");
              router.refresh();
            },
          },
        });
        if (afterDelete) router.push(afterDelete, { scroll: false });
        router.refresh();
      }}
    >
      <Trash2 aria-hidden /> Delete
    </Button>
  );
}

export function RestoreTradeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await setDeleted(id, false);
        setBusy(false);
        if (error) {
          logClientError("trade.restore", error, { id });
          toast.error("Something failed, retry.");
          return;
        }
        toast.success("Trade restored");
        router.refresh();
      }}
    >
      <RotateCcw aria-hidden /> Restore
    </Button>
  );
}
