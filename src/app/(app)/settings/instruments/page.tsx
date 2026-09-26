import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadEditorData } from "@/lib/data/editor";
import { InstrumentsTable } from "./instruments-table";

export const metadata: Metadata = { title: "Instruments" };

export default async function InstrumentsPage() {
  const { instruments } = await loadEditorData();
  return (
    <>
      <PageHeader title="Instruments & fees">
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings">
            <ArrowLeft aria-hidden /> Settings
          </Link>
        </Button>
      </PageHeader>
      <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
        Fees are <strong className="text-foreground">round turn per contract</strong> (all-in:
        commission + exchange + clearing). They apply to trades saved from now on; a fee typed on a
        trade overrides this default. Inactive instruments are hidden from the quick picker.
      </p>
      <InstrumentsTable instruments={instruments} />
    </>
  );
}
