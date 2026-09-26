"use client";

import { useMemo, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import type { PlaybookVersion } from "@/lib/data/playbook";
import { fmtR, pnlClass } from "@/lib/format";
import { diffSnapshots } from "@/lib/playbook/diff";
import { playbookStats, type PlaybookTrade } from "@/lib/playbook/stats";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Versions with trades per version; compare any two (fields + stats). */
export function VersionHistory({
  versions,
  trades,
}: {
  versions: PlaybookVersion[];
  trades: PlaybookTrade[];
}) {
  const newest = versions[0]?.version ?? 1;
  const [a, setA] = useState(versions[1]?.version ?? newest);
  const [b, setB] = useState(newest);
  const va = versions.find((v) => v.version === a);
  const vb = versions.find((v) => v.version === b);
  const changes = useMemo(
    () => (va && vb ? diffSnapshots(va.snapshot, vb.snapshot) : []),
    [va, vb],
  );
  const statsOf = (v: number) => playbookStats(trades.filter((t) => t.playbook_version === v));

  if (versions.length === 0)
    return <p className="text-muted-foreground text-sm">No versions yet.</p>;

  return (
    <div className="space-y-4" data-testid="version-history">
      <ul className="divide-y rounded-xl border">
        {versions.map((v) => {
          const s = statsOf(v.version);
          return (
            <li
              key={v.version}
              className="flex items-center gap-3 px-4 py-2 text-sm"
              data-testid="version-row"
            >
              <span className="w-10 font-semibold">v{v.version}</span>
              <span className="text-muted-foreground flex-1 text-xs">
                {formatInTz(v.createdAt, DISPLAY_TZ, "d MMM yyyy HH:mm")}
              </span>
              <span className="num text-muted-foreground text-xs">{s.n} trades</span>
              <span className={cn("num w-16 text-right", pnlClass(s.avgR))}>
                {s.rN ? `${fmtR(s.avgR)}/t` : "—"}
              </span>
            </li>
          );
        })}
      </ul>

      {versions.length > 1 && (
        <section className="space-y-3" aria-label="Compare versions">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Compare</span>
            <div className="w-24">
              <NativeSelect
                aria-label="From version"
                value={a}
                onChange={(e) => setA(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <span>→</span>
            <div className="w-24">
              <NativeSelect
                aria-label="To version"
                value={b}
                onChange={(e) => setB(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[a, b].map((v) => {
              const s = statsOf(v);
              return (
                <div key={v} className="bg-card rounded-lg border p-3">
                  <div className="heading-caps text-[10px]">v{v} stats</div>
                  <div className="num mt-1">
                    n={s.n} · win {s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`} ·{" "}
                    <span className={pnlClass(s.avgR)}>
                      {s.rN ? `${fmtR(s.avgR)} per trade` : "no R"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {changes.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No differences in the structured fields.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="version-diff">
              {changes.map((c) => (
                <li key={c.key} className="bg-card space-y-1 rounded-lg border p-3 text-sm">
                  <div className="heading-caps text-[10px]">{c.label}</div>
                  {c.kind === "scalar" && (
                    <p>
                      <span className="text-muted-foreground line-through">{c.before || "—"}</span>{" "}
                      → <span className="font-semibold">{c.after || "—"}</span>
                    </p>
                  )}
                  {c.kind === "list" && (
                    <p className="space-x-2">
                      {c.added.map((x) => (
                        <span key={`+${x}`} className="text-foreground">
                          + {x}
                        </span>
                      ))}
                      {c.removed.map((x) => (
                        <span key={`-${x}`} className="text-muted-foreground line-through">
                          − {x}
                        </span>
                      ))}
                    </p>
                  )}
                  {c.kind === "text" && (
                    <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
                      {c.lines.map((l, i) => (
                        <div
                          key={i}
                          className={cn(
                            l.type === "add" && "bg-primary/10",
                            l.type === "del" && "text-muted-foreground line-through",
                          )}
                        >
                          {l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
