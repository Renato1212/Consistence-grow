import { SampleBadge, weakClass } from "@/components/review/stat-bits";
import { fmtR, pnlClass } from "@/lib/format";
import { playbookStats, type Bucket, type PlaybookTrade } from "@/lib/playbook/stats";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground heading-caps text-[10px]">{label}</div>
      <div className="num text-lg font-semibold">{children}</div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="bg-card space-y-2 rounded-xl border p-4" aria-label={title}>
      <h3 className="heading-caps text-xs">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No trades.</p>
      ) : (
        <table className="num w-full text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="text-left font-normal" />
              <th className="w-1/3 font-normal" />
              <th className="text-right font-normal">n</th>
              <th className="text-right font-normal">Net R</th>
              <th className="text-right font-normal">Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={weakClass(r.n)}>
                <td className="py-1 pr-2 font-sans">{r.key}</td>
                <td>
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-foreground/50 h-full rounded-full"
                      style={{ width: `${(r.n / max) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="text-right">{r.n}</td>
                <td className={cn("text-right", pnlClass(r.netR))}>{r.rN ? fmtR(r.netR) : "—"}</td>
                <td className="text-right">
                  {r.winRate === null ? "—" : `${Math.round(r.winRate * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Stats from the linked taken trades — n everywhere, weak samples greyed. */
export function PlaybookStatsView({ trades }: { trades: PlaybookTrade[] }) {
  const s = playbookStats(trades);
  if (s.n === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        No trades linked to this playbook yet. Pick it in the trade form and stats appear here.
      </p>
    );
  }
  const maxBin = Math.max(1, ...s.histogram.map((h) => h.n));
  const maxGrade = Math.max(1, ...s.grades.map((g) => g.n));
  return (
    <div className="space-y-4" data-testid="playbook-stats">
      <section className="bg-card grid grid-cols-2 gap-4 rounded-xl border p-4 sm:grid-cols-6">
        <Tile label="Trades">
          {s.n} <SampleBadge n={s.n} />
        </Tile>
        <Tile label="Win rate">
          <span className={weakClass(s.n)}>
            {s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}
          </span>
        </Tile>
        <Tile label={`Expectancy (n=${s.rN})`}>
          <span className={cn(pnlClass(s.avgR), weakClass(s.rN))}>{fmtR(s.avgR)}</span>
        </Tile>
        <Tile label="Profit factor">
          <span className={weakClass(s.rN)}>
            {s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)}
          </span>
        </Tile>
        <Tile label="Net R">
          <span className={pnlClass(s.netR)}>{s.rN ? fmtR(s.netR) : "—"}</span>
        </Tile>
        <Tile label="Last traded">
          <span className="text-sm">
            {s.lastTraded ? formatInTz(s.lastTraded, DISPLAY_TZ, "d MMM yyyy") : "—"}
          </span>
        </Tile>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="bg-card space-y-2 rounded-xl border p-4" aria-label="R distribution">
          <h3 className="heading-caps text-xs">R distribution (n={s.rN})</h3>
          <div
            className="flex h-32 items-end gap-1.5"
            role="img"
            aria-label="R distribution histogram"
          >
            {s.histogram.map((h, i) => (
              <div
                key={h.label}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="num text-muted-foreground text-[10px]">{h.n || ""}</span>
                <div
                  className={cn("w-full max-w-6 rounded-t", i < 3 ? "bg-loss/70" : "bg-profit/70")}
                  style={{ height: `${(h.n / maxBin) * 100}%`, minHeight: h.n ? 2 : 0 }}
                  title={`${h.label}: ${h.n}`}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {s.histogram.map((h) => (
              <span
                key={h.label}
                className="num text-muted-foreground flex-1 text-center text-[9px]"
              >
                {h.label}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <tbody>
              {s.histogram.map((h) => (
                <tr key={h.label}>
                  <td>{h.label}</td>
                  <td>{h.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-card space-y-3 rounded-xl border p-4" aria-label="Process">
          <h3 className="heading-caps text-xs">Process grades</h3>
          <ul className="space-y-1.5">
            {s.grades.map((g) => (
              <li key={g.grade} className="flex items-center gap-2 text-sm">
                <span className="w-4 font-semibold">{g.grade}</span>
                <span className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full">
                  <span
                    className="bg-foreground/50 absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(g.n / maxGrade) * 100}%` }}
                  />
                </span>
                <span className="num w-6 text-right">{g.n}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs" data-testid="checklist-adherence">
            Checklist:{" "}
            {s.checklist.n === 0
              ? "no trades with a checklist yet"
              : `${s.checklist.complete}/${s.checklist.n} trades fully ticked · ${Math.round((s.checklist.avgTicked ?? 0) * 100)}% ticked on average`}
          </p>
        </section>

        <BucketTable title="By instrument" rows={s.byInstrument} />
        <BucketTable title="By time of day (exchange time)" rows={s.byTime} />
        <BucketTable title="By event proximity" rows={s.byEvent} />
      </div>
    </div>
  );
}
