import Link from "next/link";
import { Landmark } from "lucide-react";

import { loadJournalTrades, loadStatementDays } from "@/lib/data/statements";
import { fmtMoney, pnlClass } from "@/lib/format";
import { reconSummary, reconcile, verifyTrades } from "@/lib/statements/analysis";
import { cn } from "@/lib/utils";

/**
 * Broker-confirmed P/L for a day or a week (server component). Renders nothing
 * until statements exist for the period.
 */
export async function BrokerCard({ from, to, title }: { from: string; to: string; title: string }) {
  const days = await loadStatementDays({ from, to });
  if (!days.length) return null;
  const trades = await loadJournalTrades(days.map((d) => d.tradeDate));
  const summary = reconSummary(reconcile(days, trades));
  const net = days.reduce((s, d) => s + d.net, 0);
  const fees = days.reduce((s, d) => s + d.fees, 0);
  const contracts = days.reduce((s, d) => s + d.contracts, 0);
  const single = days.length === 1 ? days[0] : null;
  return (
    <section
      className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
      aria-label={title}
      data-testid="broker-card"
    >
      <Landmark className="text-muted-foreground size-6 shrink-0" aria-hidden />
      <div className="flex-1">
        <h2 className="heading-caps text-xs">{title}</h2>
        <p className="text-sm">
          <span className={cn("num font-semibold", pnlClass(net))} data-testid="broker-net">
            {fmtMoney(net)}
          </span>{" "}
          <span className="text-muted-foreground">
            net of {fmtMoney(-fees)} fees · {contracts} contracts
            {days.length > 1 ? ` · ${days.length} statement days` : ""} · journal matches{" "}
            {summary.matched}/{summary.total} product-days
          </span>
        </p>
      </div>
      <Link
        className="text-sm underline"
        href={single ? `/statements/${single.id}` : "/statements"}
      >
        {single ? "Open statement" : "Statements"}
      </Link>
    </section>
  );
}

/** Share of a playbook's trades that the broker statements confirm (server component). */
export async function BrokerVerification({
  trades,
}: {
  trades: { id: string; kind: string; trade_date: string; symbol: string }[];
}) {
  const taken = trades.filter((t) => t.kind === "taken");
  if (!taken.length) return null;
  const dates = [...new Set(taken.map((t) => t.trade_date))].toSorted();
  const days = await loadStatementDays({ from: dates[0], to: dates.at(-1)! });
  if (!days.length) return null;
  const journal = await loadJournalTrades(days.map((d) => d.tradeDate));
  const v = verifyTrades(
    taken.map((t) => ({ id: t.id, date: t.trade_date, symbol: t.symbol })),
    reconcile(days, journal),
  );
  return (
    <p
      className="bg-card text-muted-foreground flex items-center gap-2 rounded-xl border p-3 text-sm"
      data-testid="broker-verification"
    >
      <Landmark className="size-4 shrink-0" aria-hidden />
      <span>
        Broker-verified: <span className="text-foreground num">{v.verified}</span> of {v.total}{" "}
        trades sit on product-days whose journal P/L matches the statement ({v.covered} on days with
        a statement).{" "}
        <Link className="underline" href="/statements">
          Reconcile
        </Link>
      </span>
    </p>
  );
}
