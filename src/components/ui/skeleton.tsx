import { cn } from "@/lib/utils";

/** Placeholder block shown while a page loads (reduced motion: no pulse). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)} />
  );
}

/** Page-level loading state: a status for screen readers plus a layout sketch. */
export function PageSkeleton({ variant = "cards" }: { variant?: "cards" | "table" | "charts" }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" data-testid="page-skeleton">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-9 w-32" />
      </div>
      {variant === "charts" && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </>
      )}
      {variant === "table" && (
        <>
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </>
      )}
      {variant === "cards" && (
        <>
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </>
      )}
    </div>
  );
}
