import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { TagManager } from "@/components/settings/tag-manager";
import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadTagAdmin } from "@/lib/data/taxonomy";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsSettingsPage() {
  const groups = await loadTagAdmin();
  return (
    <>
      <PageHeader title="Tags">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <div className="grid max-w-4xl gap-4">
        <p className="text-muted-foreground text-sm">
          Rename, reorder, move between groups, merge duplicates (every trade moves to the other
          tag, with Undo), archive (hidden from the pickers, kept in Insights) or delete (removed
          from pickers and stats; 30 days in the trash). A group&apos;s kind drives Insights:
          mistake tags feed the mistake cost, context tags the pattern finder.
        </p>
        <TagManager groups={groups} />
      </div>
    </>
  );
}
