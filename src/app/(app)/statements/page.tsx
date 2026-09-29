import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Landmark } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shell/empty-state";
import { StatementsDashboard } from "@/components/statements/dashboard";
import { Button } from "@/components/ui/button";
import {
  loadAccounts,
  loadDayContext,
  loadJournalTrades,
  loadStatementDays,
  parseRange,
  rangeStart,
} from "@/lib/data/statements";
import { buildDashboard } from "@/lib/statements/dashboard";
import { lisbonToday } from "@/lib/time";

export const metadata: Metadata = { title: "Statements" };

export default async function StatementsPage({ searchParams }: PageProps<"/statements">) {
  const sp = await searchParams;
  const accounts = await loadAccounts();
  const upload = (
    <Button asChild>
      <Link href="/statements/upload">
        <FileUp aria-hidden />
        Upload statements
      </Link>
    </Button>
  );

  if (!accounts.length) {
    return (
      <>
        <PageHeader title="Statements" />
        <EmptyState
          icon={Landmark}
          title="No broker statements yet"
          description="Upload your daily Axia statement PDFs. Each one is checked, stored per day and product, and reconciled against your journal — the official P/L behind your analysis and playbooks."
        >
          {upload}
        </EmptyState>
      </>
    );
  }

  const requested = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = requested && accounts.includes(requested) ? requested : accounts[0];
  const range = parseRange(sp.range);
  const days = await loadStatementDays({ account, from: rangeStart(range, lisbonToday()) });
  const dates = days.map((d) => d.tradeDate);
  const [trades, ctx] = await Promise.all([
    loadJournalTrades(dates),
    dates.length ? loadDayContext(dates[0], dates.at(-1)!) : Promise.resolve(new Map()),
  ]);

  return (
    <>
      <PageHeader title="Statements">{upload}</PageHeader>
      {days.length ? (
        <StatementsDashboard
          data={buildDashboard(days, trades, ctx)}
          accounts={accounts}
          account={account}
          range={range}
        />
      ) : (
        <EmptyState
          icon={Landmark}
          title="No statements in this range"
          description="Pick a longer range or upload the missing days."
        >
          <Button variant="outline" asChild>
            <Link href={`/statements?account=${encodeURIComponent(account)}&range=all`}>
              Show all
            </Link>
          </Button>
        </EmptyState>
      )}
    </>
  );
}
