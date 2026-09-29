import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, FileText } from "lucide-react";

import { Section } from "@/components/insights/bits";
import { PageHeader } from "@/components/shell/empty-state";
import { ReconTable } from "@/components/statements/dashboard";
import { DeleteStatement } from "@/components/statements/statement-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { loadJournalTrades, loadStatement } from "@/lib/data/statements";
import { fmtMoney, pnlClass } from "@/lib/format";
import { reconcile } from "@/lib/statements/analysis";
import { multiplierMatches } from "@/lib/statements/products";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Statement" };

const plain = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function StatementPage({ params }: PageProps<"/statements/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await loadStatement(id);
  if (!s) notFound();
  const trades = await loadJournalTrades([s.tradeDate]);
  const recon = reconcile(
    [
      {
        id: s.id,
        account: s.account,
        tradeDate: s.tradeDate,
        realized: s.realized,
        fees: s.fees,
        net: s.net,
        nlv: null,
        contracts: 0,
        fills: 0,
        status: s.status,
        simulated: s.simulated,
        nlvHistory: s.nlvHistory,
        products: s.products,
      },
    ],
    trades,
  );
  const failed = s.checks.filter((c) => !c.ok && c.severity === "error");
  const warnings = s.checks.filter((c) => !c.ok && c.severity === "warning");
  const row = (label: string) => s.summaryRows[label]?.[0] ?? null;
  const conf = s.fills.filter((f) => f.section === "confirmation");
  const ps = s.fills.filter((f) => f.section === "purchase");

  return (
    <>
      <PageHeader title={`Statement ${s.tradeDate}`}>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/statements">
              <ChevronLeft aria-hidden />
              Statements
            </Link>
          </Button>
          {s.pdfUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={s.pdfUrl} target="_blank" rel="noreferrer">
                <FileText aria-hidden />
                PDF
              </a>
            </Button>
          )}
          <DeleteStatement id={s.id} label={s.tradeDate} />
        </div>
      </PageHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{s.account}</span>
          <span className="text-muted-foreground">client {s.clientCode}</span>
          {s.program && <Badge variant="outline">{s.program}</Badge>}
          {s.simulated && <Badge>Simulated</Badge>}
          {s.status === "ok" ? (
            <Badge variant="accent" data-testid="statement-status">
              <CheckCircle2 className="size-3" aria-hidden /> All checks passed
            </Badge>
          ) : (
            <Badge variant="warn" data-testid="statement-status">
              Needs attention
            </Badge>
          )}
          <span className="text-muted-foreground ml-auto text-xs">
            <Link className="underline" href={`/review/${s.tradeDate}`}>
              Debrief
            </Link>{" "}
            ·{" "}
            <Link className="underline" href="/journal">
              Journal
            </Link>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="statement-summary">
          {(
            [
              ["Realized P/L", s.realized, true],
              ["Fees", -s.fees, true],
              ["Net", s.net, true],
              ["MTD realized", row("MTD Realized P/L"), true],
              ["Open cash", row("Open Cash Balance"), false],
              ["Close cash", row("Close Cash Balance"), false],
              ["Net liquid value", row("Net Liquid Value"), false],
              ["Open trade equity", row("Open Trade Equity"), false],
            ] as [string, number | null, boolean][]
          ).map(([label, v, pnl]) => (
            <div key={label} className="bg-card rounded-xl border p-3">
              <div className="text-muted-foreground text-xs">{label}</div>
              <div className={cn("num mt-1 font-semibold", pnl && pnlClass(v))}>
                {pnl ? fmtMoney(v, s.currency) : plain(v)}
              </div>
            </div>
          ))}
        </div>

        {(failed.length > 0 || warnings.length > 0) && (
          <ul className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {[...failed, ...warnings].map((c) => (
              <li key={c.id} className="flex gap-2">
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    c.severity === "error" ? "text-loss" : "text-warn",
                  )}
                  aria-hidden
                />
                <span>
                  {c.label}
                  {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Section title="Products">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="statement-products">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3 font-normal">Code</th>
                  <th className="py-1 pr-3 font-normal">Product</th>
                  <th className="py-1 pr-3 font-normal">Instrument</th>
                  <th className="py-1 pr-3 text-right font-normal">Bought · sold</th>
                  <th className="py-1 pr-3 text-right font-normal">Avg buy · sell</th>
                  <th className="py-1 pr-3 text-right font-normal">Realized</th>
                </tr>
              </thead>
              <tbody>
                {s.products.map((p) => {
                  const ok =
                    p.tickSize && p.tickValue
                      ? multiplierMatches(
                          p.impliedMultiplier,
                          { tickSize: p.tickSize, tickValue: p.tickValue },
                          p.priceScale,
                        )
                      : null;
                  const px = (v: number | null) =>
                    v === null ? "—" : Number((v * p.priceScale).toPrecision(8)).toString();
                  return (
                    <tr key={`${p.code}-${p.contract}`} className="border-t">
                      <td className="num py-1.5 pr-3">{p.code}</td>
                      <td className="py-1.5 pr-3">
                        {p.contract} {p.exchange} {p.description}
                      </td>
                      <td className="py-1.5 pr-3">
                        {p.symbol ?? (
                          <Link className="text-warn underline" href="/settings/statements">
                            map
                          </Link>
                        )}
                        {ok === false && (
                          <Badge variant="warn" className="ml-1.5">
                            size mismatch
                          </Badge>
                        )}
                      </td>
                      <td className="num py-1.5 pr-3 text-right">
                        {p.longQty} · {p.shortQty}
                      </td>
                      <td className="num py-1.5 pr-3 text-right text-xs">
                        {px(p.avgBuy)} · {px(p.avgSell)}
                      </td>
                      <td className={cn("num py-1.5 pr-3 text-right", pnlClass(p.realized))}>
                        {fmtMoney(p.realized, s.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Journal vs broker"
          description="Broker realized P/L per product against the gross P/L of the journal trades of this trading day (±$1)."
        >
          <ReconTable rows={recon} showDate={false} />
        </Section>

        {s.nlvHistory.length > 0 && (
          <Section title="Last net liquid values">
            <table className="text-sm">
              <tbody>
                {s.nlvHistory.map((n) => (
                  <tr key={n.offset}>
                    <td className="text-muted-foreground py-0.5 pr-4">
                      {n.offset ? `T${n.offset}` : "Today"}
                    </td>
                    <td className="num py-0.5 pr-4 text-right">{plain(n.nlv)}</td>
                    <td className={cn("num py-0.5 text-right", pnlClass(n.change))}>
                      {n.change === null ? "" : fmtMoney(n.change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-fit">
              Fills ({conf.length} confirmations · {ps.length} purchase &amp; sale) and all{" "}
              {s.checks.length} checks
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-4">
            <Section title="Checks">
              <ul className="grid gap-0.5 text-xs">
                {s.checks.map((c) => (
                  <li key={c.id} className="flex gap-1.5">
                    <span className={c.ok ? "text-muted-foreground" : "text-warn"}>
                      {c.ok ? "✓" : "✗"}
                    </span>
                    {c.label}
                    {c.detail && <span className="text-muted-foreground">— {c.detail}</span>}
                  </li>
                ))}
              </ul>
            </Section>
            {[
              ["Future confirmations", conf],
              ["Purchase & sale", ps],
            ].map(([title, rows]) => (
              <Section key={title as string} title={title as string}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground text-left">
                      <tr>
                        <th className="py-1 pr-3 font-normal">Date</th>
                        <th className="py-1 pr-3 font-normal">Product</th>
                        <th className="py-1 pr-3 font-normal">Side</th>
                        <th className="py-1 pr-3 text-right font-normal">Qty</th>
                        <th className="py-1 pr-3 text-right font-normal">Price</th>
                        <th className="py-1 pr-3 text-right font-normal">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rows as typeof s.fills).map((f) => (
                        <tr key={`${f.section}-${f.seq}`} className="border-t">
                          <td className="py-1 pr-3">{f.tradeDate}</td>
                          <td className="py-1 pr-3">
                            {f.code} {f.contract}
                          </td>
                          <td className="py-1 pr-3">{f.side}</td>
                          <td className="num py-1 pr-3 text-right">{f.qty}</td>
                          <td className="num py-1 pr-3 text-right">{f.priceText}</td>
                          <td className="num py-1 pr-3 text-right">{plain(f.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ))}
            {s.unparsed.length > 0 && (
              <Section title="Lines not read">
                <ul className="text-muted-foreground grid gap-0.5 text-xs">
                  {s.unparsed.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </Section>
            )}
          </CollapsibleContent>
        </Collapsible>

        <p className="text-muted-foreground text-xs">
          {s.source === "api" ? "Delivered over the API" : "Uploaded"}
          {s.fileName ? ` · ${s.fileName}` : ""} · stored{" "}
          {s.createdAt.slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>
    </>
  );
}
