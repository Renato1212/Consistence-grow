"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Pencil } from "lucide-react";

import { MediaGallery, type MediaItem } from "@/components/trade/media-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { JournalTrade } from "@/lib/data/journal";
import { domainMeta, type DomainCode } from "@/lib/domains";
import { fmtDuration, fmtMoney, fmtR, fmtTicks, pnlClass } from "@/lib/format";
import { DISPLAY_TZ, TZ, formatInTz } from "@/lib/time";
import { EXIT_REASON_LABEL } from "@/lib/trading/trade-form";
import { cn } from "@/lib/utils";
import { DeleteTradeButton } from "./trade-actions";

export function TradeDetailSheet({
  trade,
  media,
}: {
  trade: JournalTrade | null;
  media: MediaItem[];
}) {
  const router = useRouter();
  const close = () => router.push("/journal", { scroll: false });
  return (
    <Sheet open={!!trade} onOpenChange={(o) => !o && close()}>
      <SheetContent aria-describedby={undefined} data-testid="trade-detail">
        {trade && <Detail trade={trade} media={media} />}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

function Detail({ trade: t, media }: { trade: JournalTrade; media: MediaItem[] }) {
  const observed = t.kind === "observed";
  const when = (iso: string | null) =>
    iso
      ? `${formatInTz(iso, DISPLAY_TZ, "dd MMM yyyy HH:mm:ss")} · NY ${formatInTz(iso, TZ.newYork, "HH:mm")}`
      : "—";
  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-5 pr-12">
        <SheetTitle className="flex items-center gap-2 text-base">
          {t.direction === "long" ? (
            <ArrowUpRight className="size-5" aria-hidden />
          ) : (
            <ArrowDownRight className="size-5" aria-hidden />
          )}
          {t.symbol} {observed ? (t.direction === "long" ? "up-move" : "down-move") : t.direction}
          {t.kind !== "taken" && (
            <Badge variant="outline">{t.kind === "missed" ? "Missed" : "Observed"}</Badge>
          )}
        </SheetTitle>
        <SheetDescription className="num mt-1">{when(t.entry_at)}</SheetDescription>
        {!observed && (
          <div className="mt-4 flex items-baseline gap-4">
            <span className={cn("num text-2xl font-bold", pnlClass(t.r_multiple))}>
              {t.no_stop ? "no R" : fmtR(t.r_multiple)}
            </span>
            <span className={cn("num text-lg", pnlClass(t.net_pnl))}>
              {fmtMoney(t.net_pnl, t.currency)}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <MediaGallery items={media} />

        <dl className="divide-y">
          <Row label={observed ? "Start → end" : "Entry → exit"}>
            {t.entry_price} → {t.exit_price ?? "open"}
          </Row>
          {t.stop_price !== null && <Row label="Stop">{t.stop_price}</Row>}
          {t.target_price !== null && <Row label="Target">{t.target_price}</Row>}
          <Row label={observed ? "Move" : "Ticks"}>{fmtTicks(t.ticks)}</Row>
          {!observed && <Row label="Contracts">{t.contracts}</Row>}
          {!observed && (
            <Row label="Gross / fees">
              {fmtMoney(t.gross_pnl, t.currency)} /{" "}
              {fmtMoney(t.fees_total === null ? null : -t.fees_total, t.currency)}
            </Row>
          )}
          <Row label="Exit time">{when(t.exit_at)}</Row>
          <Row label="Duration">{fmtDuration(t.duration_sec)}</Row>
          <Row label="Session · bucket">
            {t.session ?? "—"} · {t.time_bucket ?? "—"} CT
          </Row>
          {(t.mae_ticks !== null || t.mfe_ticks !== null) && (
            <Row label="MAE / MFE">
              {t.mae_ticks ?? "—"}t / {t.mfe_ticks ?? "—"}t
            </Row>
          )}
          {t.entry_type && <Row label="Entry type">{t.entry_type}</Row>}
          {t.exit_reason && (
            <Row label="Exit reason">
              {EXIT_REASON_LABEL[t.exit_reason as keyof typeof EXIT_REASON_LABEL] ?? t.exit_reason}
            </Row>
          )}
          {t.confidence !== null && <Row label="Confidence">{t.confidence}/5</Row>}
        </dl>

        <div className="flex flex-wrap gap-1.5">
          {[t.primary_domain, ...t.secondary_domains].filter(Boolean).map((d, i) => {
            const m = domainMeta(d as DomainCode);
            return (
              <Badge key={d} variant="outline" className="gap-1.5">
                <span className={cn("size-2 rounded-full", m.bgClassName)} aria-hidden />
                {m.short}
                {i === 0 && <span className="text-muted-foreground">primary</span>}
              </Badge>
            );
          })}
          {t.playbook_name && <Badge variant="accent">{t.playbook_name}</Badge>}
          {t.checklist && Object.keys(t.checklist).length > 0 && (
            <Badge variant="outline" data-testid="checklist-badge">
              Checklist {Object.values(t.checklist).filter(Boolean).length}/
              {Object.keys(t.checklist).length}
            </Badge>
          )}
          {t.tag_names.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>

        {(t.grade_context || t.grade_edge || t.grade_process) && (
          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ["Context", t.grade_context, t.grade_context_reason],
                ["Edge", t.grade_edge, t.grade_edge_reason],
                ["Process", t.grade_process, t.grade_process_reason],
              ] as const
            ).map(([label, g, why]) => (
              <div key={label} className="bg-card rounded-md border p-2">
                <dt className="heading-caps text-muted-foreground text-[10px]">{label}</dt>
                <dd className="text-lg font-bold">{g ?? "—"}</dd>
                {why && <dd className="text-muted-foreground text-xs">{why}</dd>}
              </div>
            ))}
          </dl>
        )}

        {(
          [
            ["Trigger", t.move_trigger],
            ["Phases", t.move_phases],
            [observed ? "Notes" : "Thesis", t.thesis],
            ["Management", t.management],
            ["Lesson", t.lesson],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <section key={label}>
              <h3 className="heading-caps text-muted-foreground mb-1 text-[10px]">{label}</h3>
              <p className="text-sm whitespace-pre-wrap">{v}</p>
            </section>
          ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-4">
        <DeleteTradeButton id={t.id} afterDelete="/journal" />
        <Button asChild>
          <Link href={`/journal/${t.id}`}>
            <Pencil aria-hidden /> Edit
          </Link>
        </Button>
      </div>
    </div>
  );
}
