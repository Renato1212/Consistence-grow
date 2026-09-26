import Link from "next/link";
import { Pencil } from "lucide-react";

import { EventRowButton } from "@/components/calendar/calendar-view";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { EditorInstrument, EditorPlaybook } from "@/lib/data/editor";
import type { Rule } from "@/lib/data/prep";
import type { DayResult } from "@/lib/data/today";
import { fmtMoney } from "@/lib/format";
import { sortLevels, type PrepSnapshot } from "@/lib/prep/prep-form";
import { cn } from "@/lib/utils";
import { Countdown } from "./countdown";

function Card({
  title,
  children,
  aside,
  className,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("bg-card space-y-3 rounded-xl border p-4", className)}
      aria-label={title}
    >
      <div className="flex items-center gap-2">
        <h2 className="heading-caps text-xs">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Gauge({
  label,
  used,
  max,
  format,
}: {
  label: string;
  used: number;
  max: number;
  format: (n: number) => string;
}) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="space-y-1" data-testid="risk-gauge">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="num">
          {format(used)} / {format(max)}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 100 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-foreground/50",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Compact read-only view of the session plan, for use during the session. */
export function PlanView({
  prep,
  events,
  instruments,
  playbooks,
  rules,
  result,
  editHref,
}: {
  prep: PrepSnapshot;
  events: CalendarEvent[];
  instruments: EditorInstrument[];
  playbooks: EditorPlaybook[];
  rules: Rule[];
  result: DayResult;
  editHref: string;
}) {
  const symbol = new Map(instruments.map((i) => [i.id, i.symbol]));
  const levels = sortLevels(prep.levels.filter((l) => l.priceLow.trim()));
  const strong = levels.filter((l) => l.strength > 1);
  const weak = levels.length - strong.length;
  const byInstrument = new Map<string, typeof strong>();
  for (const l of strong)
    byInstrument.set(l.instrumentId, [...(byInstrument.get(l.instrumentId) ?? []), l]);
  const playbookName = new Map(playbooks.map((p) => [p.id, p.name]));
  const usdLoss = Math.max(0, -(result.byCurrency.USD ?? 0));
  const rLoss = Math.max(0, -result.netR);
  const maxUsd = Number(prep.maxLossUsd) || 0;
  const maxR = Number(prep.maxLossR) || 0;
  const maxTrades = Number(prep.maxTrades) || 0;
  const hasRisk = maxUsd > 0 || maxR > 0 || maxTrades > 0;

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="plan-view">
      {prep.intention && (
        <p className="border-primary col-span-full border-l-4 pl-3 text-base font-semibold">
          {prep.intention}
        </p>
      )}

      <Card
        title="Key levels"
        aside={
          <Button variant="ghost" size="sm" asChild>
            <Link href={editHref}>
              <Pencil aria-hidden />
              Edit prep
            </Link>
          </Button>
        }
      >
        {strong.length === 0 ? (
          <p className="text-muted-foreground text-sm">No strength 2–3 levels in this prep.</p>
        ) : (
          <div className="space-y-3">
            {[...byInstrument.entries()].map(([instId, list]) => (
              <div key={instId}>
                <h3 className="heading-caps text-muted-foreground mb-1 text-[10px]">
                  {symbol.get(instId) ?? "—"}
                </h3>
                <ul className="space-y-1">
                  {list.map((l) => (
                    <li
                      key={l.id}
                      data-testid="plan-level"
                      className={cn(
                        "flex items-baseline gap-2 border-l-4 pl-2 text-sm",
                        l.strength === 3
                          ? "border-l-primary font-semibold"
                          : "border-l-foreground/30",
                      )}
                    >
                      <span className="num">
                        {l.priceLow}
                        {l.priceHigh && `–${l.priceHigh}`}
                      </span>
                      <span className="text-muted-foreground text-xs">{l.levelType}</span>
                      {l.note && (
                        <span className="text-muted-foreground truncate text-xs">· {l.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {weak > 0 && (
          <p className="text-muted-foreground text-xs">{weak} strength-1 level(s) hidden.</p>
        )}
      </Card>

      <Card title="Today's events">
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing on the calendar.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {events.map((e) => (
              <li key={e.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <EventRowButton event={e} />
                </div>
                <Countdown at={e.startsAt} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Scenarios">
        {prep.scenarios.length === 0 ? (
          <p className="text-muted-foreground text-sm">No scenarios.</p>
        ) : (
          <ul className="space-y-2">
            {prep.scenarios.map((s) => (
              <li key={s.id} className="text-sm" data-testid="plan-scenario">
                <span className="text-muted-foreground mr-1 text-xs">
                  {[symbol.get(s.instrumentId), s.direction].filter(Boolean).join(" ")}
                </span>
                <span className="font-semibold">If</span> {s.ifText}{" "}
                <span className="font-semibold">→ then</span> {s.thenText}
                {s.playbookId && (
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({playbookName.get(s.playbookId)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Risk & rules">
        {hasRisk ? (
          <div className="space-y-3">
            {maxUsd > 0 && (
              <Gauge
                label="Daily loss ($)"
                used={usdLoss}
                max={maxUsd}
                format={(n) => fmtMoney(n).replace("+", "")}
              />
            )}
            {maxR > 0 && (
              <Gauge
                label="Daily loss (R)"
                used={rLoss}
                max={maxR}
                format={(n) => `${n.toFixed(1)}R`}
              />
            )}
            {maxTrades > 0 && (
              <Gauge label="Trades" used={result.n} max={maxTrades} format={(n) => String(n)} />
            )}
            {prep.maxSize && (
              <p className="text-muted-foreground text-xs">Max size per trade: {prep.maxSize}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No risk plan set in this prep.</p>
        )}
        {rules.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {rules.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
