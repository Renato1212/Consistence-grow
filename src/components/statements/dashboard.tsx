"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { N, Section, fmtPct, fmtPctCI } from "@/components/insights/bits";
import { SampleBadge, weakClass } from "@/components/review/stat-bits";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import type { StatementRange } from "@/lib/data/statements";
import { fmtMoney, pnlClass } from "@/lib/format";
import type { Interval } from "@/lib/insights/metrics";
import type { BucketRow, ReconRow, ReconStatus } from "@/lib/statements/analysis";
import type { DashboardData } from "@/lib/statements/dashboard";
import { cn } from "@/lib/utils";

import { AccountCurve, StatementCalendar, VolumeScatter } from "./charts";

const LIST_PAGE = 60;

const fmtMoneyCI = (ci: Interval | null) => (ci ? `${fmtMoney(ci.lo)} … ${fmtMoney(ci.hi)}` : "");

export function StatementsDashboard({
  data,
  accounts,
  account,
  range,
  unsplit = [],
}: {
  data: DashboardData;
  accounts: string[];
  account: string;
  range: StatementRange;
  /** Statements with products not split into trades yet. */
  unsplit?: string[];
}) {
  const unsplitSet = new Set(unsplit);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.push(`${pathname}?${next.toString()}`);
  };
  const s = data.stats;
  const r = data.reconSummary;
  const [listAll, setListAll] = useState(false);
  const list = listAll ? data.list : data.list.slice(0, LIST_PAGE);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {accounts.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Account</span>
            <NativeSelect
              aria-label="Account"
              value={account}
              onChange={(e) => go({ account: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        <Segmented
          size="sm"
          label="Range"
          value={range}
          onChange={(v) => go({ range: v })}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "ytd", label: "YTD" },
            { value: "all", label: "All" },
          ]}
        />
        {data.simulated && <Badge>Simulated account</Badge>}
      </div>

      {(data.attention.length > 0 || data.gaps.length > 0 || data.unmapped.length > 0) && (
        <ul
          className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          data-testid="statements-warnings"
        >
          {data.attention.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <AlertTriangle className="text-warn size-4 shrink-0" aria-hidden />
              The statement of {a.date} did not pass every check —{" "}
              <Link className="underline" href={`/statements/${a.id}`}>
                review it
              </Link>
            </li>
          ))}
          {data.gaps.map((g) => (
            <li key={`${g.after}-${g.before}`} className="flex items-center gap-2">
              <AlertTriangle className="text-warn size-4 shrink-0" aria-hidden />
              The balance does not roll from {g.after} to {g.before} — a statement in between is
              probably missing.
            </li>
          ))}
          {data.unmapped.length > 0 && (
            <li className="flex items-center gap-2">
              <AlertTriangle className="text-warn size-4 shrink-0" aria-hidden />
              Product code{data.unmapped.length > 1 ? "s" : ""} {data.unmapped.join(", ")} not
              linked to an instrument —{" "}
              <Link className="underline" href="/settings/statements">
                map in Settings
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="statements-kpis">
        <Kpi label="Net P/L" n={s.n} unit="days">
          <span className={cn("num text-xl font-semibold", pnlClass(s.net))}>
            {fmtMoney(s.net)}
          </span>
        </Kpi>
        <Kpi label="Winning days" n={s.n} unit="days" sub={fmtPctCI(s.winCI)}>
          <span className={cn("num text-xl font-semibold", weakClass(s.n))}>
            {fmtPct(s.winRate)}
          </span>
        </Kpi>
        <Kpi label="Average day" n={s.n} unit="days" sub={fmtMoneyCI(s.meanCI)}>
          <span className={cn("num text-xl font-semibold", pnlClass(s.mean), weakClass(s.n))}>
            {fmtMoney(s.mean)}
          </span>
        </Kpi>
        <Kpi
          label="Journal completeness"
          sub={r.total ? `${r.matched} of ${r.total} product-days match` : "no product-days"}
        >
          <span className="num text-xl font-semibold" data-testid="kpi-completeness">
            {fmtPct(r.completeness)}
          </span>
        </Kpi>
        <Kpi label="Avg win · avg loss day">
          <span className="num">
            <span className="text-profit">{fmtMoney(s.avgWin)}</span> ·{" "}
            <span className="text-loss">{fmtMoney(s.avgLoss)}</span>
          </span>
        </Kpi>
        <Kpi label="Profit factor (days)">
          <span className="num">{s.profitFactor ?? "—"}</span>
        </Kpi>
        <Kpi label="Max drawdown" sub={`streaks: ${s.longestWin} up · ${s.longestLoss} down`}>
          <span className={cn("num", pnlClass(s.maxDrawdown))}>{fmtMoney(s.maxDrawdown)}</span>
        </Kpi>
        <Kpi
          label="Contracts per day"
          sub={`fees ${fmtMoney(-s.fees)} · best ${fmtMoney(s.best?.net)} · worst ${fmtMoney(s.worst?.net)}`}
        >
          <span className="num">{s.avgContracts ?? "—"}</span>
        </Kpi>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Account curve">
          <AccountCurve points={data.curve} ids={data.ids} />
        </Section>
        <Section title="Daily P/L">
          <StatementCalendar days={data.calendar} initialMonth={data.initialMonth} />
        </Section>
      </div>

      <Section
        title="By product"
        description="Where the money comes from and where it goes. Per round turn = net ÷ contracts closed."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="statements-products">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3 font-normal">Instrument</th>
                <th className="py-1 pr-3 font-normal">Days</th>
                <th className="py-1 pr-3 text-right font-normal">Net</th>
                <th className="py-1 pr-3 font-normal">Share</th>
                <th className="py-1 pr-3 text-right font-normal">Contracts</th>
                <th className="py-1 pr-3 text-right font-normal">Per round turn</th>
                <th className="py-1 pr-3 font-normal">Winning days</th>
                <th className="py-1 pr-3 text-right font-normal">Best · worst</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.key} className="border-t">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{p.key}</span>
                    {p.mappingOk === false && (
                      <Badge variant="warn" className="ml-1.5">
                        check mapping
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <N n={p.days} />
                  </td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(p.net))}>
                    {fmtMoney(p.net)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="bg-muted h-1.5 w-20 rounded">
                      <div
                        className={cn("h-1.5 rounded", p.net >= 0 ? "bg-profit" : "bg-loss")}
                        style={{ width: `${Math.round((p.share ?? 0) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="num py-1.5 pr-3 text-right">{p.contracts}</td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(p.perContract))}>
                    {fmtMoney(p.perContract)}
                  </td>
                  <td className={cn("num py-1.5 pr-3", weakClass(p.days))}>
                    {fmtPct(p.winRate)}{" "}
                    <span className="text-muted-foreground text-xs">{fmtPctCI(p.winCI)}</span>
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-xs">
                    <span className={pnlClass(p.best)}>{fmtMoney(p.best)}</span> ·{" "}
                    <span className={pnlClass(p.worst)}>{fmtMoney(p.worst)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section
          title="Size vs results"
          description={
            data.rho === null
              ? "Needs at least 5 days for the volume/P&L correlation."
              : `Rank correlation between contracts traded and the day's P/L: ρ = ${data.rho} (n=${data.stats.n} days)${data.rho <= -0.3 ? " — bigger days tend to be worse days." : data.rho >= 0.3 ? " — bigger days tend to be better days." : " — no clear relation."}`
          }
        >
          <BucketTable rows={data.buckets} label="Volume" testId="statements-size" />
          <VolumeScatter points={data.scatter} />
        </Section>
        <Section title="By weekday">
          <BucketTable rows={data.weekdays} label="Weekday" testId="statements-weekday" />
        </Section>
      </div>

      <Section
        title="Process vs broker P/L"
        description="Each day's official P/L grouped by your prep, readiness, rules and events. Hypotheses to test, not conclusions."
      >
        {data.process.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No prep, debrief or events on these days yet.
          </p>
        ) : (
          <div
            className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            data-testid="statements-process"
          >
            {data.process.map((g) => (
              <div key={g.dimension}>
                <h3 className="mb-1 text-xs font-medium">{g.dimension}</h3>
                <BucketTable rows={g.rows} label={g.dimension} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Reconciliation rows={data.recon} />

      <Section
        title="Statements"
        aside={
          data.list.length > LIST_PAGE ? (
            <button
              type="button"
              className="text-muted-foreground text-xs underline"
              onClick={() => setListAll((v) => !v)}
            >
              {listAll ? `Latest ${LIST_PAGE}` : `Show all ${data.list.length}`}
            </button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="statements-list">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3 font-normal">Day</th>
                <th className="py-1 pr-3 text-right font-normal">Net</th>
                <th className="py-1 pr-3 text-right font-normal">Contracts</th>
                <th className="py-1 pr-3 font-normal">Products</th>
                <th className="py-1 pr-3 font-normal">Checks</th>
                <th className="py-1 pr-3 font-normal">Trades</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="py-1.5 pr-3">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/statements/${d.id}`}
                    >
                      {d.date}
                    </Link>
                  </td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(d.net))}>
                    {fmtMoney(d.net)}
                  </td>
                  <td className="num py-1.5 pr-3 text-right">{d.contracts}</td>
                  <td className="text-muted-foreground py-1.5 pr-3 text-xs">
                    {d.products.join(" · ")}
                  </td>
                  <td className="py-1.5 pr-3">
                    {d.status === "ok" ? (
                      <Badge variant="outline">ok</Badge>
                    ) : (
                      <Badge variant="warn">attention</Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    {unsplitSet.has(d.id) ? (
                      <Link className="text-warn underline" href={`/statements/${d.id}#trades`}>
                        split
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Kpi({
  label,
  n,
  unit,
  sub,
  children,
}: {
  label: string;
  n?: number;
  unit?: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {label}
        {n !== undefined && <SampleBadge n={n} />}
      </div>
      <div className="mt-1">{children}</div>
      {(sub || n !== undefined) && (
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          {n !== undefined && `n=${n} ${unit ?? ""}`}
          {n !== undefined && sub ? " · " : ""}
          {sub}
        </p>
      )}
    </div>
  );
}

export function BucketTable({
  rows,
  label,
  testId,
}: {
  rows: BucketRow[];
  label: string;
  testId?: string;
}) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">Not enough days yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 pr-3 font-normal">{label}</th>
            <th className="py-1 pr-3 font-normal">Days</th>
            <th className="py-1 pr-3 text-right font-normal">Net</th>
            <th className="py-1 pr-3 text-right font-normal">Avg day</th>
            <th className="py-1 pr-3 font-normal">Winning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t">
              <td className="py-1.5 pr-3">{r.label}</td>
              <td className="py-1.5 pr-3">
                <N n={r.n} />
              </td>
              <td className={cn("num py-1.5 pr-3 text-right", pnlClass(r.net))}>
                {fmtMoney(r.net)}
              </td>
              <td className={cn("num py-1.5 pr-3 text-right", pnlClass(r.mean), weakClass(r.n))}>
                {fmtMoney(r.mean)}
                {r.meanCI && (
                  <span className="text-muted-foreground block text-[10px]">
                    {fmtMoneyCI(r.meanCI)}
                  </span>
                )}
              </td>
              <td className={cn("num py-1.5 pr-3", weakClass(r.n))}>
                {fmtPct(r.winRate)}{" "}
                <span className="text-muted-foreground text-xs">{fmtPctCI(r.winCI)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_LABEL: Record<ReconStatus, string> = {
  matched: "matched",
  differs: "differs",
  missing: "missing in journal",
  unmapped: "unmapped code",
  extra: "not on the statement",
};

export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  return (
    <Badge variant={status === "matched" ? "outline" : "warn"} data-status={status}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function ReconActions({ row }: { row: ReconRow }) {
  if (row.status === "missing")
    return (
      <span className="flex flex-wrap gap-2 text-xs">
        {row.statementId && (
          <Link className="underline" href={`/statements/${row.statementId}#trades`}>
            Split into trades
          </Link>
        )}
        <Link className="underline" href="/journal/new">
          Log trade
        </Link>
        <Link className="underline" href="/settings/import">
          Import fills
        </Link>
      </span>
    );
  if (row.status === "unmapped")
    return (
      <Link className="text-xs underline" href="/settings/statements">
        Map code
      </Link>
    );
  if (row.journalTrades.length)
    return (
      <span className="flex flex-wrap gap-2 text-xs">
        {row.journalTrades.slice(0, 3).map((id, i) => (
          <Link
            key={id}
            className="inline-flex items-center gap-0.5 underline"
            href={`/journal?trade=${id}`}
          >
            trade {i + 1}
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        ))}
        {row.journalTrades.length > 3 && <span>+{row.journalTrades.length - 3}</span>}
      </span>
    );
  return null;
}

export function ReconTable({ rows, showDate = true }: { rows: ReconRow[]; showDate?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="recon-table">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            {showDate && <th className="py-1 pr-3 font-normal">Day</th>}
            <th className="py-1 pr-3 font-normal">Instrument</th>
            <th className="py-1 pr-3 text-right font-normal">Broker</th>
            <th className="py-1 pr-3 text-right font-normal">Journal (gross)</th>
            <th className="py-1 pr-3 text-right font-normal">Difference</th>
            <th className="py-1 pr-3 font-normal">Status</th>
            <th className="py-1 pr-3 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.date}-${row.key}-${row.status}`}
              className="border-t"
              data-status={row.status}
            >
              {showDate && (
                <td className="py-1.5 pr-3">
                  {row.statementId ? (
                    <Link className="hover:underline" href={`/statements/${row.statementId}`}>
                      {row.date}
                    </Link>
                  ) : (
                    row.date
                  )}
                </td>
              )}
              <td className="py-1.5 pr-3">{row.key}</td>
              <td className={cn("num py-1.5 pr-3 text-right", pnlClass(row.broker))}>
                {fmtMoney(row.broker)}
              </td>
              <td className={cn("num py-1.5 pr-3 text-right", pnlClass(row.journal))}>
                {fmtMoney(row.journal)}
                {row.journalTrades.length > 0 && (
                  <span className="text-muted-foreground ml-1 text-[10px]">
                    ({row.journalTrades.length})
                  </span>
                )}
              </td>
              <td className="num py-1.5 pr-3 text-right">
                {row.diff === null ? "—" : fmtMoney(row.diff)}
              </td>
              <td className="py-1.5 pr-3">
                <ReconStatusBadge status={row.status} />
              </td>
              <td className="py-1.5 pr-3">
                <ReconActions row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RECON_PAGE = 50;

function Reconciliation({ rows }: { rows: ReconRow[] }) {
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(RECON_PAGE);
  const open = rows.filter((r) => r.status !== "matched");
  const list = all ? rows : open;
  const shown = list.slice(0, limit);
  return (
    <Section
      title="Journal vs broker"
      description="For every statement day and product: broker realized P/L against the gross P/L of your journal trades (±$1). Complete, matching data is what makes playbook stats trustworthy."
      aside={
        <button
          type="button"
          className="text-muted-foreground text-xs underline"
          onClick={() => {
            setAll((v) => !v);
            setLimit(RECON_PAGE);
          }}
        >
          {all ? "Only open items" : `Show all ${rows.length}`}
        </button>
      }
    >
      {shown.length ? (
        <>
          <ReconTable rows={shown} />
          {list.length > limit && (
            <button
              type="button"
              className="text-muted-foreground text-xs underline"
              onClick={() => setLimit((n) => n + RECON_PAGE)}
            >
              Show {Math.min(RECON_PAGE, list.length - limit)} more ({list.length - limit} not
              shown)
            </button>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="recon-clean">
          Every broker product-day matches the journal.
        </p>
      )}
    </Section>
  );
}
