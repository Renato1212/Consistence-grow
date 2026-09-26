import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";

import { RestoreTradeButton } from "@/components/journal/trade-actions";
import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadTrash } from "@/lib/data/journal";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const trash = await loadTrash();
  return (
    <>
      <PageHeader title="Trash">
        <Button asChild variant="ghost" size="sm">
          <Link href="/journal">
            <ArrowLeft aria-hidden /> Journal
          </Link>
        </Button>
      </PageHeader>
      <p className="text-muted-foreground mb-4 text-sm">
        Deleted trades stay here for 30 days, then they are removed for good.
      </p>
      {trash.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Deleted trades appear here and can be restored for 30 days."
        />
      ) : (
        <ul className="space-y-2">
          {trash.map((t) => {
            return (
              <li
                key={t.id}
                className="bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
                data-testid="trash-item"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {t.symbol} {t.direction}{" "}
                    {t.kind !== "taken" && (
                      <span className="text-muted-foreground text-xs">({t.kind})</span>
                    )}
                  </div>
                  <div className="text-muted-foreground num text-xs">
                    {formatInTz(t.entry_at, DISPLAY_TZ, "dd MMM yyyy HH:mm")} · {t.daysLeft} days
                    left
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("num text-sm", pnlClass(t.r_multiple))}>
                    {fmtR(t.r_multiple)}
                  </span>
                  <span className={cn("num text-sm", pnlClass(t.net_pnl))}>
                    {fmtMoney(t.net_pnl, t.currency)}
                  </span>
                  <RestoreTradeButton id={t.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
