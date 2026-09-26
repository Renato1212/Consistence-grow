import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadHolidays, loadSettings, loadTemplates } from "@/lib/data/calendar";
import { lisbonToday } from "@/lib/time";
import { CalendarSettings } from "./calendar-settings";

export const metadata: Metadata = { title: "Calendar settings" };

export default async function CalendarSettingsPage() {
  const [settings, templates, holidays] = await Promise.all([
    loadSettings(),
    loadTemplates(),
    loadHolidays(),
  ]);
  return (
    <>
      <PageHeader title="Calendar & sessions">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <CalendarSettings
        settings={settings}
        templates={templates}
        holidays={holidays}
        thisYear={Number(lisbonToday().slice(0, 4))}
      />
    </>
  );
}
