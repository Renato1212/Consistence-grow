import Link from "next/link";
import { Newspaper } from "lucide-react";

import { Markdown } from "@/components/prep/markdown";
import { extractTldr } from "@/lib/briefs/tldr";
import type { Brief } from "@/lib/data/briefs";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";

/** TL;DR of the delivered Macro Desk brief, with a link to the full brief in the prep. */
export function BriefCard({ brief }: { brief: Brief }) {
  const tldr = extractTldr(brief.markdown);
  return (
    <section
      className="bg-card space-y-2 rounded-xl border p-4"
      aria-label="Macro Desk brief"
      data-testid="brief-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Newspaper className="text-primary size-4" aria-hidden />
        <h2 className="heading-caps text-xs">
          Macro Desk · {brief.session === "EU" ? "European-open" : "US-session"} brief
        </h2>
        <span className="text-muted-foreground text-xs">
          received {formatInTz(brief.receivedAt, DISPLAY_TZ, "HH:mm")}
        </span>
        <Link
          href={`/prep/${brief.date}/${brief.session.toLowerCase()}#brief`}
          className="text-primary ml-auto text-xs hover:underline"
        >
          Full brief →
        </Link>
      </div>
      {tldr.length > 0 ? (
        <Markdown>{tldr.map((b) => `- ${b}`).join("\n")}</Markdown>
      ) : (
        <p className="text-muted-foreground text-sm">
          No TL;DR section found — open the full brief.
        </p>
      )}
    </section>
  );
}
