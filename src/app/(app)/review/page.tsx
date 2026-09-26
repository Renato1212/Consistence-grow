import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, NotebookPen } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isoWeekKey, isoWeekOf } from "@/lib/calendar/dates";
import { loadReviewIndex } from "@/lib/data/week";
import { fmtR, pnlClass } from "@/lib/format";
import { formatInTz, lisbonToday } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review" };

/** Calendar date only: formatted at UTC noon so no zone can shift it. */
const fmtDay = (d: string, p = "EEE d MMM") => formatInTz(`${d}T12:00:00Z`, "UTC", p);

const STATUS = {
  none: { label: "No debrief", variant: "outline" as const },
  draft: { label: "Draft", variant: "outline" as const },
  complete: { label: "Debriefed", variant: "default" as const },
};

export default async function ReviewPage() {
  const today = lisbonToday();
  const { days, weeks } = await loadReviewIndex(today);
  const current = isoWeekOf(today);

  return (
    <>
      <PageHeader title="Review">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/review/week/${isoWeekKey(current.year, current.week)}`}>This week</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/review/today">
              <NotebookPen aria-hidden />
              Debrief (D)
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <section aria-label="Days" className="space-y-2">
          <h2 className="heading-caps text-xs">Days</h2>
          {days.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No trading days yet"
              description="Days with trades or a debrief show up here. After the close, press D to debrief the day."
            />
          ) : (
            <ul className="divide-y rounded-xl border" data-testid="review-days">
              {days.map((d) => (
                <li key={d.date}>
                  <Link
                    href={`/review/${d.date}`}
                    className="hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="w-28 text-sm font-semibold">{fmtDay(d.date)}</span>
                    <span className="text-muted-foreground num flex-1 text-xs">
                      {d.n} trade{d.n === 1 ? "" : "s"}
                    </span>
                    <span className={cn("num w-16 text-right text-sm", pnlClass(d.netR))}>
                      {d.rN ? fmtR(d.netR) : "—"}
                    </span>
                    <Badge
                      variant={STATUS[d.debrief].variant}
                      className={cn(
                        "w-24 justify-center text-[10px]",
                        d.debrief === "none" && "text-muted-foreground",
                      )}
                    >
                      {STATUS[d.debrief].label}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Weeks" className="space-y-2">
          <h2 className="heading-caps text-xs">Weeks</h2>
          <ul className="divide-y rounded-xl border" data-testid="review-weeks">
            {weeks.map((w) => (
              <li key={w.key}>
                <Link
                  href={`/review/week/${w.key}`}
                  className="hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="flex-1">
                    <span className="font-semibold">W{w.key.slice(6)}</span>{" "}
                    <span className="text-muted-foreground text-xs">
                      {fmtDay(w.start, "d MMM")}
                    </span>
                  </span>
                  <span className="text-muted-foreground num text-xs">{w.n}</span>
                  <span className={cn("num w-14 text-right", pnlClass(w.netR))}>
                    {w.rN ? fmtR(w.netR) : "—"}
                  </span>
                  {w.reviewed && (
                    <span className="text-primary text-xs" aria-label="Reviewed">
                      ✓
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
