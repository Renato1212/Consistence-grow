"use client";

import { AlertCircle, Check, Loader2, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AutosaveStatus } from "@/lib/autosave/controller";
import { cn } from "@/lib/utils";

/** Always-visible save state: Saved / Saving… / Error — retry. */
export function SaveStatus({
  status,
  onRetry,
  missing,
}: {
  status: AutosaveStatus;
  onRetry: () => void;
  missing?: string[];
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={status}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs",
        status === "error" && "bg-destructive/10 text-destructive",
        status !== "error" && "text-muted-foreground",
      )}
    >
      {status === "saved" && (
        <>
          <Check className="text-profit size-3.5" aria-hidden /> Saved
        </>
      )}
      {(status === "saving" || status === "pending") && (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="size-3.5" aria-hidden /> Error —
          <Button
            variant="link"
            size="sm"
            className="text-destructive h-auto p-0 text-xs"
            onClick={onRetry}
          >
            retry
          </Button>
        </>
      )}
      {status === "blocked" && (
        <>
          <PenLine className="size-3.5" aria-hidden />
          <span>
            Draft kept on this device
            {missing && missing.length > 0 && <> — add {missing.join(", ")} to save</>}
          </span>
        </>
      )}
      {status === "idle" && <>Not saved yet</>}
    </div>
  );
}
