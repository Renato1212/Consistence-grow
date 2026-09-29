import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { RuleManager } from "@/components/settings/rule-manager";
import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadRuleAdmin } from "@/lib/data/taxonomy";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesSettingsPage() {
  const rules = await loadRuleAdmin();
  return (
    <>
      <PageHeader title="Rules">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <div className="grid max-w-4xl gap-4">
        <p className="text-muted-foreground text-sm">
          Your trading rules, checked in every prep and debrief in this order. Turning a rule off
          stops asking it; past checks keep their history.
        </p>
        <RuleManager rules={rules} />
      </div>
    </>
  );
}
