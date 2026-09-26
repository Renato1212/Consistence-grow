import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Download, FileUp } from "lucide-react";

import { PageHeader } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BACKUP_KEEP } from "@/lib/export/build";
import { createClient, getUser } from "@/lib/supabase/server";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { BackupNow } from "./backup-now";

export const metadata: Metadata = { title: "Data & backups" };

function fmtSize(bytes: number | undefined) {
  if (!bytes) return "—";
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function DataPage() {
  const user = await getUser();
  const supabase = await createClient();
  const list = user
    ? await supabase.storage
        .from("backups")
        .list(user.id, { limit: 100, sortBy: { column: "name", order: "desc" } })
    : { data: [] };
  const files = (list.data ?? []).filter((f) => f.name.endsWith(".json"));
  const signed = files.length
    ? await supabase.storage.from("backups").createSignedUrls(
        files.map((f) => `${user!.id}/${f.name}`),
        3600,
      )
    : { data: [] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const cronConfigured = !!process.env.CRON_SECRET && !!process.env.SUPABASE_SECRET_KEY;

  return (
    <>
      <PageHeader title="Data & backups">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ChevronLeft aria-hidden />
            Settings
          </Link>
        </Button>
      </PageHeader>
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Import trades</CardTitle>
            <CardDescription>
              CSV of fills from your platform (Rithmic, MotiveWave…) → round-trip trades, without
              duplicates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/settings/import">
                <FileUp aria-hidden /> Import CSV
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export everything</CardTitle>
            <CardDescription>
              A zip with every table as JSON, one CSV per table, and your screenshots and videos as
              download links (valid 7 days). Includes items in the trash.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/api/export" download data-testid="export-link">
                <Download aria-hidden /> Download everything (.zip)
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Backups
              <Badge variant={cronConfigured ? "accent" : "warn"} data-testid="cron-status">
                {cronConfigured ? "Weekly backup on" : "Weekly backup not configured"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Every Sunday 03:00 UTC a full JSON backup is stored privately (the last {BACKUP_KEEP}{" "}
              are kept) and trash older than 30 days is deleted for good.
              {!cronConfigured &&
                " To switch it on, add SUPABASE_SECRET_KEY and CRON_SECRET in Vercel → Settings → Environment Variables."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <BackupNow />
            {files.length === 0 ? (
              <p className="text-muted-foreground text-sm">No backups yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="backup-list">
                {files.map((f) => {
                  const url = urls.get(`${user!.id}/${f.name}`);
                  return (
                    <li key={f.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="num flex-1">{f.name.replace(".json", "")}</span>
                      <span className="text-muted-foreground num text-xs">
                        {fmtSize((f.metadata as { size?: number } | null)?.size)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {f.updated_at ? formatInTz(f.updated_at, DISPLAY_TZ, "d MMM HH:mm") : ""}
                      </span>
                      {url && (
                        <Button asChild variant="ghost" size="sm">
                          <a href={url} download={f.name}>
                            <Download aria-hidden /> Download
                          </a>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
