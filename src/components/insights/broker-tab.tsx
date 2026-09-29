"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";

import { BucketTable } from "@/components/statements/dashboard";
import { Button } from "@/components/ui/button";
import { fmtMoney, pnlClass } from "@/lib/format";
import {
  accountStats,
  productStats,
  reconSummary,
  reconcile,
  sizeBuckets,
  type JournalTrade,
  type StatementDay,
} from "@/lib/statements/analysis";
import { cn } from "@/lib/utils";

import { N, Section, fmtPct, fmtPctCI } from "./bits";

export type BrokerTabData = {
  account: string;
  days: StatementDay[];
  trades: JournalTrade[];
} | null;

/**
 * The broker's own numbers for the filter's date range. Statements have no
 * setup data, so only the date part of the filter applies.
 */
export function BrokerTab({
  broker,
  bounds,
}: {
  broker: BrokerTabData;
  bounds: { from: string | null; to: string | null };
}) {
  const view = useMemo(() => {
    if (!broker) return null;
    const days = broker.days.filter(
      (d) =>
        (!bounds.from || d.tradeDate >= bounds.from) && (!bounds.to || d.tradeDate <= bounds.to),
    );
    return {
      days,
      stats: accountStats(days),
      products: productStats(days),
      buckets: sizeBuckets(days),
      recon: reconSummary(reconcile(days, broker.trades)),
    };
  }, [broker, bounds.from, bounds.to]);

  if (!broker || !view || !view.days.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <Landmark className="text-muted-foreground size-8" aria-hidden />
        <p className="text-muted-foreground max-w-md text-sm">
          {broker
            ? "No broker statements in this date range."
            : "Upload your daily broker statements to see the official P/L per day and product next to your journal."}
        </p>
        <Button asChild variant="outline">
          <Link href={broker ? "/statements" : "/statements/upload"}>
            {broker ? "Open Statements" : "Upload statements"}
          </Link>
        </Button>
      </div>
    );
  }
  const s = view.stats;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4" data-testid="broker-tab">
      <p className="text-muted-foreground text-xs">
        Account {broker.account} · only the date range of the filter applies (statements carry no
        setup data) ·{" "}
        <Link className="underline" href="/statements">
          full view
        </Link>
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Broker net P/L">
          <span className={cn("num text-lg font-semibold", pnlClass(s.net))}>
            {fmtMoney(s.net)}
          </span>
        </Tile>
        <Tile label="Statement days">
          <N n={s.n} />
        </Tile>
        <Tile label="Winning days">
          <span className="num">{fmtPct(s.winRate)}</span>{" "}
          <span className="text-muted-foreground text-xs">{fmtPctCI(s.winCI)}</span>
        </Tile>
        <Tile label="Journal completeness">
          <span className="num">{fmtPct(view.recon.completeness)}</span>{" "}
          <span className="text-muted-foreground text-xs">
            {view.recon.matched}/{view.recon.total} product-days
          </span>
        </Tile>
      </div>
      <Section title="By product (broker)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3 font-normal">Instrument</th>
                <th className="py-1 pr-3 font-normal">Days</th>
                <th className="py-1 pr-3 text-right font-normal">Net</th>
                <th className="py-1 pr-3 text-right font-normal">Per round turn</th>
              </tr>
            </thead>
            <tbody>
              {view.products.map((p) => (
                <tr key={p.key} className="border-t">
                  <td className="py-1.5 pr-3">{p.key}</td>
                  <td className="py-1.5 pr-3">
                    <N n={p.days} />
                  </td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(p.net))}>
                    {fmtMoney(p.net)}
                  </td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(p.perContract))}>
                    {fmtMoney(p.perContract)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Volume vs results">
        <BucketTable rows={view.buckets} label="Volume" />
      </Section>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
