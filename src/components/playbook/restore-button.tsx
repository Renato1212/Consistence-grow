"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";

export function RestorePlaybookButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const { error } = await createClient()
          .from("playbooks")
          .update({ deleted_at: null })
          .eq("id", id);
        if (error) {
          logClientError("playbook.restore", error, { id });
          toast.error("Not restored — retry.");
          return;
        }
        toast.success(`Restored "${name}"`);
        router.refresh();
      }}
    >
      Restore
    </Button>
  );
}
