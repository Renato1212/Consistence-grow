import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { CodeMapEditor } from "@/components/statements/code-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCodeMap } from "@/lib/data/statements";

export const metadata: Metadata = { title: "Statements settings" };

export default async function StatementSettingsPage() {
  const { rows, instruments } = await loadCodeMap();
  return (
    <>
      <PageHeader title="Statements">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Product codes</CardTitle>
            <CardDescription>
              Axia prints its own clearing codes (21 = ZN, MS = MES, EF = MCL…). Each code seen in
              your statements is linked to an instrument; a change applies to every past and future
              statement. “Size verified” means the statement amounts imply exactly that
              instrument&apos;s contract size. The price scale converts printed prices (the yen
              future is printed per 10,000).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <CodeMapEditor rows={rows} instruments={instruments} />
            ) : (
              <p className="text-muted-foreground text-sm">
                Codes appear here after the first{" "}
                <Link className="underline" href="/statements/upload">
                  statement upload
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Automatic delivery</CardTitle>
            <CardDescription>
              Instead of uploading by hand, any script or mail rule can post each morning&apos;s PDF
              to <code className="text-foreground">POST /api/ingest/statement</code> with a token of
              scope <strong>Statements</strong> (create it in{" "}
              <Link className="underline" href="/settings/integrations">
                Integrations
              </Link>
              ) as <code className="text-foreground">Authorization: Bearer …</code> and the PDF as
              the body (<code className="text-foreground">Content-Type: application/pdf</code>). The
              same file twice is ignored; a different file for a stored day answers 409 unless{" "}
              <code className="text-foreground">?replace=1</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
