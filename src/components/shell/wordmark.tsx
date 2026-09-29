import { cn } from "@/lib/utils";

/** "CONSISTENT GROW" wordmark: white + orange, bold caps (AXIA style). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("heading-caps whitespace-nowrap", className)}>
      Consistent <span className="text-primary-ink">Grow</span>
    </span>
  );
}
