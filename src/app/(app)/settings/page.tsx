import type { Metadata } from "next";

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
          Instruments, tags, rules, session times, calendar templates and import/export arrive with
          the phases that use them.
        </p>
      </div>
    </>
  );
}
