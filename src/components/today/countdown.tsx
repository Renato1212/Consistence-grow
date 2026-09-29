"use client";

import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";

function fmt(ms: number) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

/** "in 12 min" / "3 min ago" for an event, updating live. */
export function Countdown({ at, className }: { at: string; className?: string }) {
  const now = useNow(15_000);
  if (now === null) return <span className={cn("num w-20 text-right text-xs", className)} />;
  const ms = Date.parse(at) - now;
  return (
    <span
      className={cn(
        "num w-20 shrink-0 pr-3 text-right text-xs",
        ms > 0 && ms <= 15 * 60000 ? "text-primary-ink font-semibold" : "text-muted-foreground",
        className,
      )}
      data-testid="countdown"
    >
      {ms > 0 ? `in ${fmt(ms)}` : `${fmt(ms)} ago`}
    </span>
  );
}
