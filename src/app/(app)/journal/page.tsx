import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { JournalView } from "@/components/journal/journal-view";
import { TradeDetailSheet } from "@/components/journal/trade-detail-sheet";
import { PageHeader } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { loadJournal, loadJournalTrade } from "@/lib/data/journal";
import { loadMedia } from "@/lib/data/media";

export const metadata: Metadata = { title: "Journal" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  const params = await searchParams;
  const detailId =
    typeof params.trade === "string" && UUID.test(params.trade) ? params.trade : null;

  const [{ trades, truncated }, detail, media] = await Promise.all([
    loadJournal(),
    detailId ? loadJournalTrade(detailId) : Promise.resolve(null),
    detailId
      ? loadMedia("trade", [detailId])
      : Promise.resolve({} as Awaited<ReturnType<typeof loadMedia>>),
  ]);

  return (
    <>
      <PageHeader title="Journal">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/journal/trash">
            <Trash2 aria-hidden /> Trash
          </Link>
        </Button>
      </PageHeader>
      <JournalView trades={trades} truncated={truncated} />
      <TradeDetailSheet trade={detail} media={detailId ? (media[detailId] ?? []) : []} />
    </>
  );
}
