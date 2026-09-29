"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";

/** Calm fallback: the details go to error_logs, the user gets "retry". */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logClientError("app.boundary", error, {
      digest: error.digest ?? null,
      path: typeof window === "undefined" ? null : window.location.pathname,
    });
  }, [error]);
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center"
    >
      <h2 className="heading-caps text-base">Something failed to load</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Nothing you saved is lost. Check your connection and retry.
      </p>
      <Button onClick={reset}>
        <RotateCcw aria-hidden />
        Retry
      </Button>
    </div>
  );
}
