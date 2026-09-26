import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getUser();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-xl gap-6">
        <Link
          href="/settings/instruments"
          className="bg-card hover:border-primary/60 flex items-center justify-between rounded-xl border p-5 transition-colors"
        >
          <div>
            <div className="font-semibold">Instruments & fees</div>
            <div className="text-muted-foreground text-sm">
              Commissions per contract, active markets, tick specs
            </div>
          </div>
          <ChevronRight className="text-muted-foreground size-5" aria-hidden />
        </Link>
        <Link
          href="/settings/calendar"
          className="bg-card hover:border-primary/60 flex items-center justify-between rounded-xl border p-5 transition-colors"
        >
          <div>
            <div className="font-semibold">Calendar & sessions</div>
            <div className="text-muted-foreground text-sm">
              Session times, be-flat banner, recurring releases, exchange holidays
            </div>
          </div>
          <ChevronRight className="text-muted-foreground size-5" aria-hidden />
        </Link>
        <Link
          href="/settings/integrations"
          className="bg-card hover:border-primary/60 flex items-center justify-between rounded-xl border p-5 transition-colors"
        >
          <div>
            <div className="font-semibold">Integrations</div>
            <div className="text-muted-foreground text-sm">
              Daily Macro Desk brief delivery, API tokens
            </div>
          </div>
          <ChevronRight className="text-muted-foreground size-5" aria-hidden />
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Signed in as <span className="text-foreground">{user?.email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SetPasswordForm />
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-sm">
          Tags, rules and import/export arrive with the phases that use them.
        </p>
      </div>
    </>
  );
}
