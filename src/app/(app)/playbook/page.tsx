import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { RestorePlaybookButton } from "@/components/playbook/restore-button";
import { SampleBadge, weakClass } from "@/components/review/stat-bits";
import { PageHeader } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadPlaybookList } from "@/lib/data/playbook";
import { DOMAINS } from "@/lib/domains";
import { fmtR, pnlClass } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/playbook/form";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Playbook" };

export default async function PlaybookPage({ searchParams }: PageProps<"/playbook">) {
  const sp = await searchParams;
  const showRetired = sp.retired === "1";
  const { cards, deleted } = await loadPlaybookList();
  const visible = cards.filter((c) => showRetired || c.status !== "retired");
  const retiredCount = cards.filter((c) => c.status === "retired").length;

  return (
    <>
      <PageHeader title="Playbook">
        {retiredCount > 0 && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={showRetired ? "/playbook" : "/playbook?retired=1"}>
              {showRetired ? "Hide retired" : `Show retired (${retiredCount})`}
            </Link>
          </Button>
        )}
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-5">
        {DOMAINS.map((d) => {
          const items = visible.filter((p) => p.primaryDomain === d.code);
          return (
            <section
              key={d.code}
              aria-labelledby={`domain-${d.code}`}
              className="min-w-0 space-y-3"
              data-testid={`domain-${d.code}`}
            >
              <h2
                id={`domain-${d.code}`}
                className="heading-caps flex items-center gap-2 text-[11px]"
              >
                <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
                {d.short}
                <span className="text-muted-foreground num">{items.length}</span>
                <Link
                  href={`/playbook/new?domain=${d.code}`}
                  className="text-muted-foreground hover:text-foreground ml-auto"
                  aria-label={`New ${d.short} playbook`}
                >
                  <Plus className="size-4" aria-hidden />
                </Link>
              </h2>
              <ul className="space-y-2">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/playbook/${p.id}`}
                      className={cn(
                        "bg-card hover:border-primary/60 block space-y-2 rounded-lg border border-l-4 p-3 transition-colors",
                        p.status === "retired" && "opacity-60",
                      )}
                      style={{
                        borderLeftColor: `var(--domain-${d.code === "CENTRAL_BANKS" ? "central-banks" : d.code.toLowerCase()})`,
                      }}
                      data-testid="playbook-card"
                    >
                      <p className="text-sm leading-snug font-semibold">{p.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {STATUS_LABEL[p.status]}
                        </Badge>
                        <span className="text-muted-foreground text-[10px]">v{p.version}</span>
                        <SampleBadge n={p.n} />
                      </div>
                      <dl className="num grid grid-cols-3 gap-1 text-xs">
                        <div>
                          <dt className="text-muted-foreground text-[10px]">n</dt>
                          <dd>{p.n}</dd>
                        </div>
                        <div className={weakClass(p.n)}>
                          <dt className="text-muted-foreground text-[10px]">Win</dt>
                          <dd>{p.winRate === null ? "—" : `${Math.round(p.winRate * 100)}%`}</dd>
                        </div>
                        <div className={weakClass(p.rN)}>
                          <dt className="text-muted-foreground text-[10px]">Exp.</dt>
                          <dd className={pnlClass(p.avgR)}>{fmtR(p.avgR)}</dd>
                        </div>
                      </dl>
                      <p className="text-muted-foreground text-[10px]">
                        {p.lastTraded
                          ? `Last traded ${formatInTz(p.lastTraded, DISPLAY_TZ, "d MMM")}`
                          : "Not traded yet"}
                      </p>
                    </Link>
                  </li>
                ))}
                {items.length === 0 && (
                  <li>
                    <Link
                      href={`/playbook/new?domain=${d.code}`}
                      className="text-muted-foreground hover:text-foreground block rounded-lg border border-dashed p-3 text-xs"
                    >
                      + New {d.short} playbook
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      {deleted.length > 0 && (
        <section className="mt-10 space-y-2" aria-label="Recently deleted">
          <h2 className="heading-caps text-muted-foreground text-xs">Recently deleted (30 days)</h2>
          <ul className="divide-y rounded-xl border">
            {deleted.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{d.name}</span>
                <RestorePlaybookButton id={d.id} name={d.name} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
