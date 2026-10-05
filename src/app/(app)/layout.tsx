import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Clock } from "@/components/shell/clock";
import { BlockAlerts } from "@/components/routine/block-alerts";
import { BeFlatBanner } from "@/components/today/be-flat-banner";
import { CommandPalette } from "@/components/shell/command-palette";
import { LogTradeFab } from "@/components/shell/log-trade-fab";
import { BottomNav, TopNavLinks } from "@/components/shell/nav-links";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Wordmark } from "@/components/shell/wordmark";
import { APP_NAME } from "@/lib/app";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Defence in depth: the proxy already redirects, but never render app
  // chrome without a verified user.
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/today" aria-label={APP_NAME} className="text-sm">
            <Wordmark />
          </Link>
          <TopNavLinks />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Clock />
            <CommandPalette />
            <ThemeToggle />
            <Button variant="ghost" size="icon" asChild>
              <Link href="/settings" aria-label="Settings">
                <Settings aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <BeFlatBanner />
      <BlockAlerts />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-36 md:pb-24">{children}</main>

      <LogTradeFab />
      <BottomNav />
    </div>
  );
}
