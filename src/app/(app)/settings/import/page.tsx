import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ImportWizard } from "@/components/import/import-wizard";
import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadImportSetup } from "@/lib/data/import";

export const metadata: Metadata = { title: "Import trades" };

export default async function ImportPage() {
  const { instruments, presets } = await loadImportSetup();
  return (
    <>
      <PageHeader title="Import trades">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <ImportWizard instruments={instruments} presets={presets} />
    </>
  );
}
