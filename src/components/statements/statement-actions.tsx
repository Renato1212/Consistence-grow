"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";

/** Move a statement to the trash (30 days), with Undo. */
export function DeleteStatement({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    const supabase = createClient();
    const res = await supabase
      .from("statements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (res.error) {
      logClientError("statements.delete", res.error);
      toast.error("Not deleted — retry.");
      return;
    }
    toast(`Statement ${label} moved to the trash`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await supabase.from("statements").update({ deleted_at: null }).eq("id", id);
          if (undo.error) {
            toast.error(
              undo.error.code === "23505"
                ? "Another statement for this day is active — delete it first."
                : "Undo failed — retry.",
            );
            return;
          }
          router.push(`/statements/${id}`);
          router.refresh();
        },
      },
    });
    router.push("/statements");
    router.refresh();
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={remove}
      disabled={busy}
      data-testid="delete-statement"
    >
      <Trash2 aria-hidden />
      Delete
    </Button>
  );
}
