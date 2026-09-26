import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadRecentBriefs, loadTokens } from "@/lib/data/briefs";
import { Integrations } from "./integrations";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const [tokens, briefs] = await Promise.all([loadTokens(), loadRecentBriefs(10)]);
  return (
    <>
      <PageHeader title="Integrations">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <Integrations tokens={tokens} briefs={briefs} />
    </>
  );
}
