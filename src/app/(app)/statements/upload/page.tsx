import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { StatementUpload } from "@/components/statements/statement-upload";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Upload statements" };

export default function UploadStatementsPage() {
  return (
    <>
      <PageHeader title="Upload statements">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/statements">
            <ChevronLeft aria-hidden />
            Statements
          </Link>
        </Button>
      </PageHeader>
      <div className="max-w-4xl">
        <StatementUpload />
      </div>
    </>
  );
}
