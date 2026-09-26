"use client";

import Link from "next/link";

import { MediaGallery, MediaManager, type MediaItem } from "@/components/trade/media-manager";
import { fmtR, pnlClass } from "@/lib/format";
import type { PlaybookTrade } from "@/lib/playbook/stats";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Linked trades with media (A-process first) + manually pinned example media. */
export function PlaybookExamples({
  playbookId,
  examples,
  pinned,
}: {
  playbookId: string;
  examples: { trade: PlaybookTrade; media: MediaItem[] }[];
  pinned: MediaItem[];
}) {
  return (
    <div className="space-y-6" data-testid="playbook-examples">
      <section className="space-y-3">
        <h3 className="heading-caps text-xs">From linked trades</h3>
        {examples.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No linked trades with screenshots yet. Best A-process trades appear here first.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {examples.map(({ trade: t, media }) => (
              <li
                key={t.id}
                className="bg-card space-y-2 rounded-xl border p-3"
                data-testid="example-trade"
              >
                <Link
                  href={`/journal?trade=${t.id}`}
                  className="flex items-center gap-2 text-sm hover:underline"
                >
                  <span className="font-semibold">
                    {t.symbol} {t.direction}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatInTz(t.entry_at, DISPLAY_TZ, "d MMM yyyy")}
                  </span>
                  {t.grade_process && <span className="text-xs">Process {t.grade_process}</span>}
                  <span className={cn("num ml-auto", pnlClass(t.r_multiple))}>
                    {fmtR(t.r_multiple)}
                  </span>
                </Link>
                <MediaGallery items={media} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="heading-caps text-xs">Pinned examples</h3>
        <MediaManager ownerType="playbook" ownerId={playbookId} ready initial={pinned} />
      </section>
    </div>
  );
}
