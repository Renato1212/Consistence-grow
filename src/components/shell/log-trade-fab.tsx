import Link from "next/link";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

export const LOG_TRADE_HREF = "/journal/new";

/** Floating "+ Log trade" button present on every app page. */
export function LogTradeFab() {
  return (
    <Link
      href={LOG_TRADE_HREF}
      aria-label="Log trade (N)"
      className={cn(
        "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 fixed right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-medium shadow-lg transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6",
      )}
    >
      <Plus className="size-5" aria-hidden />
      Log trade
    </Link>
  );
}
