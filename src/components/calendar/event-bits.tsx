import { IMPORTANCE_LABEL, lisbonTime, nativeTime } from "@/lib/calendar/display";
import type { CalendarEvent } from "@/lib/calendar/types";
import { domainMeta } from "@/lib/domains";
import { cn } from "@/lib/utils";

/** Three bars; high importance is orange so it reads at a glance. */
export function ImportanceBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span
      className="inline-flex items-end gap-0.5"
      role="img"
      aria-label={`${IMPORTANCE_LABEL[level]} importance`}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-sm",
            i === 1 ? "h-1.5" : i === 2 ? "h-2.5" : "h-3.5",
            i <= level ? (level === 3 ? "bg-primary" : "bg-foreground/70") : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}

export function DomainDot({
  code,
  className,
}: {
  code: CalendarEvent["primaryDomain"];
  className?: string;
}) {
  const d = domainMeta(code);
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", d.bgClassName, className)}
      title={d.label}
      aria-hidden
    />
  );
}

/** Lisbon time first, native time in muted text. */
export function EventTime({ event }: { event: Pick<CalendarEvent, "startsAt" | "nativeTz"> }) {
  const native = nativeTime(event.startsAt, event.nativeTz);
  return (
    <span className="num inline-flex items-baseline gap-1.5">
      <span className="font-semibold">{lisbonTime(event.startsAt)}</span>
      {native && <span className="text-muted-foreground text-[11px]">{native}</span>}
    </span>
  );
}
