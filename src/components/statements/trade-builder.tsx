"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Split,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { BuildFill, BuildProduct } from "@/lib/data/statement-trades";
import { fmtMoney, fmtPrice, pnlClass } from "@/lib/format";
import {
  draftKey,
  draftsFromGroups,
  moveFill,
  restoreDraft,
  toPayload,
  type DraftTrade,
} from "@/lib/statements/builder";
import {
  checkSplit,
  entryExit,
  finestSplit,
  isUnambiguous,
  matchJournal,
  oneTrade,
  splitInto,
  type SplitCheck,
  type SplitIssue,
  type SplitSpec,
} from "@/lib/statements/split";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";

type Mode = "suggested" | "one" | "journal" | "manual";

export type TradeBuilderProps = {
  products: BuildProduct[];
  tradeDate: string;
  currency: string;
};

/**
 * Split each statement product's day into trades and add them to the journal.
 * The statement has no fill times, so every split is a suggestion the owner
 * confirms; the day always adds up to the broker's realized P/L.
 */
export function TradeBuilder({ products, tradeDate, currency }: TradeBuilderProps) {
  const traded = products.filter((p) => p.fills.length > 0);
  if (!traded.length)
    return <p className="text-muted-foreground text-sm">No fills on this trading day.</p>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {traded.map((p) => (
        <ProductCard key={p.productId} product={p} tradeDate={tradeDate} currency={currency} />
      ))}
    </div>
  );
}

function ProductCard({
  product: p,
  tradeDate,
  currency,
}: {
  product: BuildProduct;
  tradeDate: string;
  currency: string;
}) {
  const title = `${p.symbol ?? p.code} · ${p.contract}`;
  return (
    <section
      className="min-w-0 rounded-lg border p-3"
      aria-label={`Trades ${p.symbol ?? p.code}`}
      data-testid="build-product"
      data-code={p.code}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-muted-foreground text-xs">{p.description}</span>
        <span className="text-muted-foreground text-xs">
          {p.fills.length} fills · broker{" "}
          <span className={cn("num", pnlClass(p.realized))}>{fmtMoney(p.realized, currency)}</span>
        </span>
        <span className="ml-auto">
          {p.built.length ? (
            <Badge variant="accent" data-testid="build-status">
              <CheckCircle2 className="size-3" aria-hidden /> {p.built.length} trade
              {p.built.length === 1 ? "" : "s"} in the journal
            </Badge>
          ) : (
            <Badge variant="outline" data-testid="build-status">
              Not split yet
            </Badge>
          )}
        </span>
      </div>
      {p.built.length ? (
        <BuiltView product={p} currency={currency} />
      ) : !p.instrumentId || !p.tickSize || !p.tickValue ? (
        <p className="text-sm">
          Map this product to an instrument first in{" "}
          <Link className="text-primary-ink underline" href="/settings/statements">
            Settings → Statements
          </Link>
          .
        </p>
      ) : (
        <SplitEditor
          product={p}
          spec={{ tickSize: p.tickSize, tickValue: p.tickValue }}
          tradeDate={tradeDate}
          currency={currency}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Built trades
// ---------------------------------------------------------------------------

function BuiltView({ product: p, currency }: { product: BuildProduct; currency: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = p.built.reduce((s, t) => s + t.gross, 0);
  const reviewed = p.built.filter((t) => t.origin === "created" && t.reviewed).length;
  const created = p.built.filter((t) => t.origin === "created").length;

  const undo = async () => {
    setBusy(true);
    const r = await createClient().rpc("undo_statement_build", { p_product: p.productId });
    setBusy(false);
    setConfirm(false);
    if (r.error) {
      toast.error("Could not undo the build — retry.");
      return;
    }
    toast(
      `Build undone${created ? ` — ${created} trade${created === 1 ? "" : "s"} moved to the trash` : ""}`,
    );
    router.refresh();
  };

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="built-trades">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="py-1 pr-3 font-normal">#</th>
              <th className="py-1 pr-3 font-normal">Side</th>
              <th className="py-1 pr-3 text-right font-normal">Contracts</th>
              <th className="py-1 pr-3 text-right font-normal">Entry → exit</th>
              <th className="py-1 pr-3 text-right font-normal">Gross</th>
              <th className="py-1 pr-3 font-normal">Journal</th>
            </tr>
          </thead>
          <tbody>
            {p.built.map((t) => {
              const px = t.direction === "long" ? [t.avgBuy, t.avgSell] : [t.avgSell, t.avgBuy];
              return (
                <tr key={t.id} className="border-t">
                  <td className="num py-1.5 pr-3">{t.seq}</td>
                  <td className="py-1.5 pr-3 capitalize">{t.direction}</td>
                  <td className="num py-1.5 pr-3 text-right">{t.contracts}</td>
                  <td className="num py-1.5 pr-3 text-right text-xs">
                    {fmtPrice(px[0])} → {fmtPrice(px[1])}
                  </td>
                  <td className={cn("num py-1.5 pr-3 text-right", pnlClass(t.gross))}>
                    {fmtMoney(t.gross, currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    {t.tradeMissing || !t.tradeId ? (
                      <span className="text-warn">in the trash</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link className="underline" href={`/journal/${t.tradeId}`}>
                          {t.origin === "linked" ? "linked trade" : "open"}
                        </Link>
                        {t.timeEstimated && (
                          <span className="text-muted-foreground">· set the time</span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t text-xs">
              <td colSpan={4} className="text-muted-foreground py-1.5 pr-3">
                <ShieldCheck className="mr-1 inline size-3.5" aria-hidden />
                Sum of the trades vs broker realized
              </td>
              <td className={cn("num py-1.5 pr-3 text-right", pnlClass(total))}>
                {fmtMoney(total, currency)}
              </td>
              <td className="num text-muted-foreground py-1.5 pr-3">
                {fmtMoney(p.realized, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span>
            {created
              ? `${created} journal trade${created === 1 ? "" : "s"} will move to the trash (restorable for 30 days)`
              : "The linked trades stay in the journal and are only unlinked"}
            {reviewed ? `; ${reviewed} already reviewed` : ""}.
          </span>
          <Button size="sm" variant="destructive" onClick={undo} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Confirm undo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setConfirm(true)}>
          <Undo2 aria-hidden />
          Undo build
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split editor
// ---------------------------------------------------------------------------

const ISSUE_TEXT = (i: SplitIssue, fills: Map<string, BuildFill>): string => {
  const f = (id: string) => {
    const x = fills.get(id);
    return x ? `${x.side === "buy" ? "buy" : "sell"} ${x.qty} @ ${x.priceText}` : id;
  };
  switch (i.kind) {
    case "not-flat":
      return `The statement is not flat for this product (bought ${i.bought}, sold ${i.sold}) — check the statement.`;
    case "unallocated":
      return `${i.qty} of ${f(i.fillId)} is not in a trade.`;
    case "over-allocated":
      return `${f(i.fillId)} is used ${i.qty} too many times.`;
    case "unbalanced":
      return `Trade ${i.group + 1} is not flat (bought ${i.buyQty}, sold ${i.sellQty}).`;
    case "empty":
      return `Trade ${i.group + 1} is empty.`;
    case "no-price":
      return `${f(i.fillId)} has no price on the statement.`;
    case "total":
      return `The trades add up to ${i.actual}, the broker says ${i.expected}.`;
  }
};

type Selection = { fillId: string; from: string | null; max: number };

function SplitEditor({
  product: p,
  spec,
  tradeDate,
  currency,
}: {
  product: BuildProduct;
  spec: SplitSpec;
  tradeDate: string;
  currency: string;
}) {
  const router = useRouter();
  const fillsById = useMemo(() => new Map(p.fills.map((f) => [f.id, f])), [p.fills]);
  const finest = useMemo(() => finestSplit(p.fills), [p.fills]);
  const maxTrades = finest?.groups.length ?? 1;
  const journal = useMemo(
    () => (p.journal.length ? matchJournal(p.fills, p.journal, spec) : null),
    [p.fills, p.journal, spec],
  );
  const unambiguous = useMemo(() => isUnambiguous(p.fills), [p.fills]);

  const initial = (): { mode: Mode; k: number; drafts: DraftTrade[] } => {
    const stored = restoreDraft(safeGet(draftKey(p.productId)), p.fills);
    if (stored) return { mode: "manual", k: maxTrades, drafts: stored.drafts };
    if (journal) return { mode: "journal", k: maxTrades, drafts: journalDrafts() };
    return { mode: "suggested", k: maxTrades, drafts: draftsFromGroups(finest?.groups ?? []) };
  };
  function journalDrafts(): DraftTrade[] {
    if (!journal) return [];
    return draftsFromGroups(
      journal.trades.map((t) => t.allocations),
      (i) => {
        const j = p.journal.find((x) => x.id === journal.trades[i].id)!;
        return { direction: j.direction, linkTradeId: j.id };
      },
    );
  }
  const [state, setState] = useState(initial);
  const { mode, k, drafts } = state;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moveQty, setMoveQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const buildId = useRef<string | null>(null);

  // Keep a local copy of manual work (a reload never loses it).
  useEffect(() => {
    if (mode === "manual")
      safeSet(draftKey(p.productId), JSON.stringify({ v: 1, at: Date.now(), mode, drafts }));
  }, [mode, drafts, p.productId]);

  const check: SplitCheck = useMemo(
    () =>
      checkSplit(
        p.fills,
        drafts.map((d) => d.allocations),
        spec,
        p.realized,
      ),
    [p.fills, drafts, spec, p.realized],
  );
  const payload = useMemo(() => toPayload(drafts, tradeDate), [drafts, tradeDate]);
  const pool = p.fills.filter((f) => (check.remaining.get(f.id) ?? 0) > 0);
  const ready = check.ok && payload.ok && drafts.length > 0;

  const setDrafts = (next: DraftTrade[], nextMode: Mode = "manual") =>
    setState((s) => ({ ...s, mode: nextMode, drafts: next }));

  const apply = (m: Mode, nextK = k) => {
    setSelection(null);
    buildId.current = null;
    if (m === "journal") setState({ mode: m, k: nextK, drafts: journalDrafts() });
    else if (m === "one")
      setState({ mode: m, k: nextK, drafts: draftsFromGroups(oneTrade(p.fills)) });
    else if (m === "suggested")
      setState({ mode: m, k: nextK, drafts: draftsFromGroups(splitInto(p.fills, nextK)) });
    safeRemove(draftKey(p.productId));
  };

  const select = (fillId: string, from: string | null, max: number) => {
    if (selection?.fillId === fillId && selection.from === from) {
      setSelection(null);
      return;
    }
    setSelection({ fillId, from, max });
    setMoveQty(max);
  };
  const move = (to: string | null | "new") => {
    if (!selection) return;
    setDrafts(moveFill(drafts, selection.fillId, selection.from, to, moveQty));
    setSelection(null);
  };
  const patch = (key: string, change: Partial<DraftTrade>) =>
    setState((s) => ({
      ...s,
      drafts: s.drafts.map((d) => (d.key === key ? { ...d, ...change } : d)),
    }));

  const create = async () => {
    if (!payload.ok || !ready) return;
    setBusy(true);
    buildId.current ??= crypto.randomUUID();
    const supabase = createClient();
    const r = await supabase.rpc("build_statement_trades", {
      p_product: p.productId,
      p_build: buildId.current,
      p_method: mode,
      p_trades: payload.trades,
    });
    setBusy(false);
    if (r.error) {
      toast.error(
        r.error.message.length < 160 ? r.error.message : "Could not create the trades — retry.",
      );
      return;
    }
    safeRemove(draftKey(p.productId));
    const res = r.data as { created: number; linked: number };
    const parts = [
      res.created
        ? `${res.created} trade${res.created === 1 ? "" : "s"} added to the journal`
        : null,
      res.linked ? `${res.linked} linked` : null,
    ].filter(Boolean);
    toast(parts.join(", ") || "Done", {
      action: {
        label: "Undo",
        onClick: () =>
          void supabase.rpc("undo_statement_build", { p_product: p.productId }).then((u) => {
            if (u.error) toast.error("Could not undo — use Undo build on the statement.");
            router.refresh();
          }),
      },
    });
    router.refresh();
  };

  if (!finest) {
    return (
      <p className="text-warn flex gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {ISSUE_TEXT(check.issues.find((i) => i.kind === "not-flat") ?? check.issues[0], fillsById)}
      </p>
    );
  }

  const modeOptions = [
    ...(journal
      ? [{ value: "journal" as const, label: `Your journal (${journal.trades.length})` }]
      : []),
    ...(maxTrades > 1 ? [{ value: "suggested" as const, label: `Suggested (${k})` }] : []),
    { value: "one" as const, label: "One trade" },
    ...(mode === "manual" ? [{ value: "manual" as const, label: "Your split" }] : []),
  ];

  return (
    <div className="grid gap-3" data-testid="split-editor">
      <p className="text-muted-foreground text-xs">
        {journal
          ? journal.method === "fills"
            ? "Your imported platform fills match the broker fills exactly: these are your real trades."
            : "The trades you logged match the broker fills (size and average prices)."
          : unambiguous
            ? "Only one split fits these fills."
            : "The statement has no fill times, so the order is unknown: this split is a suggestion that groups fills close in price. Adjust it if you remember the trades differently."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          label="How to split"
          value={mode}
          onChange={(m) => (m === "manual" ? undefined : apply(m))}
          options={modeOptions}
        />
        {mode === "suggested" && maxTrades > 1 && (
          <span className="flex items-center gap-1 text-xs">
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Fewer trades"
              disabled={k <= 1}
              onClick={() => apply("suggested", k - 1)}
            >
              <Minus aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="More trades"
              disabled={k >= maxTrades}
              onClick={() => apply("suggested", k + 1)}
            >
              <Plus aria-hidden />
            </Button>
            <span className="text-muted-foreground">up to {maxTrades}</span>
          </span>
        )}
      </div>

      {selection && (
        <div
          className="bg-muted/60 sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
          role="group"
          aria-label="Move the selected fill"
        >
          <span>
            Move{" "}
            {selection.max > 1 ? (
              <Input
                aria-label="Contracts to move"
                type="number"
                min={1}
                max={selection.max}
                value={moveQty}
                onChange={(e) =>
                  setMoveQty(
                    Math.max(1, Math.min(selection.max, Math.floor(Number(e.target.value) || 1))),
                  )
                }
                className="inline-block h-8 w-16"
              />
            ) : (
              1
            )}{" "}
            of {chipLabel(fillsById.get(selection.fillId)!)} to
          </span>
          {drafts
            .map((d, i) => ({ d, i }))
            .filter(({ d }) => d.key !== selection.from)
            .map(({ d, i }) => (
              <Button key={d.key} size="sm" variant="outline" onClick={() => move(d.key)}>
                Trade {i + 1}
              </Button>
            ))}
          <Button size="sm" variant="outline" onClick={() => move("new")}>
            <Split aria-hidden /> New trade
          </Button>
          {selection.from !== null && (
            <Button size="sm" variant="ghost" onClick={() => move(null)}>
              Take out
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
            Cancel
          </Button>
        </div>
      )}

      <ol className="grid gap-2" aria-label="Trades">
        {drafts.map((d, i) => {
          const m = check.groups[i];
          const px = m && d.direction ? entryExit(m, d.direction) : null;
          const linked = d.linkTradeId ? p.journal.find((j) => j.id === d.linkTradeId) : null;
          return (
            <li
              key={d.key}
              className={cn(
                "grid gap-2 rounded-md border p-2",
                m && !m.balanced && "border-amber-500/60",
              )}
              data-testid="draft-trade"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Trade {i + 1}</span>
                <span className="num text-muted-foreground text-xs">
                  {m?.contracts ?? 0} ct
                  {m && !m.balanced && ` · bought ${m.buyQty}, sold ${m.sellQty}`}
                </span>
                {px && (
                  <span className="num text-muted-foreground text-xs">
                    {fmtPrice(px.entry)} → {fmtPrice(px.exit)}
                  </span>
                )}
                <span
                  className={cn(
                    "num ml-auto text-sm font-semibold",
                    m?.balanced && pnlClass(m.gross),
                  )}
                >
                  {m?.balanced ? fmtMoney(m.gross, currency) : "not flat"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.allocations.map((a) => {
                  const f = fillsById.get(a.fillId)!;
                  const on = selection?.fillId === a.fillId && selection.from === d.key;
                  return (
                    <Chip
                      key={a.fillId}
                      fill={f}
                      qty={a.qty}
                      pressed={on}
                      onClick={() => select(a.fillId, d.key, a.qty)}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Segmented
                  size="sm"
                  label={`Trade ${i + 1} direction`}
                  value={d.direction}
                  onChange={(v) => patch(d.key, { direction: v })}
                  options={[
                    { value: "long", label: "Long" },
                    { value: "short", label: "Short" },
                  ]}
                />
                <label className="grid gap-0.5 text-xs">
                  <span className="text-muted-foreground">Entry (Lisbon)</span>
                  <Input
                    type="time"
                    className="h-8 w-28"
                    value={d.entry}
                    aria-label={`Trade ${i + 1} entry time`}
                    onChange={(e) => patch(d.key, { entry: e.target.value })}
                  />
                </label>
                <label className="grid gap-0.5 text-xs">
                  <span className="text-muted-foreground">Exit</span>
                  <Input
                    type="time"
                    className="h-8 w-28"
                    value={d.exit}
                    aria-label={`Trade ${i + 1} exit time`}
                    onChange={(e) => patch(d.key, { exit: e.target.value })}
                  />
                </label>
                {linked && (
                  <span className="text-muted-foreground text-xs">
                    Links your{" "}
                    {linked.timeEstimated
                      ? ""
                      : `${formatInTz(linked.entryAt, DISPLAY_TZ, "HH:mm")} `}
                    {linked.direction} {linked.contracts} (no new trade)
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {pool.length > 0 && (
        <div
          className="grid gap-1.5 rounded-md border border-dashed p-2"
          aria-label="Fills not in a trade"
        >
          <span className="text-muted-foreground text-xs">Not in a trade yet</span>
          <div className="flex flex-wrap gap-1.5">
            {pool.map((f) => {
              const left = check.remaining.get(f.id) ?? 0;
              return (
                <Chip
                  key={f.id}
                  fill={f}
                  qty={left}
                  pressed={selection?.fillId === f.id && selection.from === null}
                  onClick={() => select(f.id, null, left)}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-1 text-sm" aria-live="polite" data-testid="split-check">
        <span className="flex flex-wrap items-center gap-2">
          {check.ok ? (
            <CheckCircle2 className="text-primary-ink size-4" aria-hidden />
          ) : (
            <AlertTriangle className="text-warn size-4" aria-hidden />
          )}
          {drafts.length} trade{drafts.length === 1 ? "" : "s"} · sum{" "}
          <span className={cn("num", pnlClass(check.total))}>
            {fmtMoney(check.total, currency)}
          </span>
          · broker{" "}
          <span className={cn("num", pnlClass(p.realized))}>{fmtMoney(p.realized, currency)}</span>
        </span>
        {!check.ok &&
          check.issues.slice(0, 4).map((i, n) => (
            <span key={n} className="text-warn text-xs">
              {ISSUE_TEXT(i, fillsById)}
            </span>
          ))}
        {check.ok &&
          !payload.ok &&
          payload.errors.slice(0, 4).map((e) => (
            <span key={e.key + e.message} className="text-muted-foreground text-xs">
              {e.message}
            </span>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={create} disabled={!ready || busy} data-testid="create-trades">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {drafts.some((d) => d.linkTradeId)
            ? "Save to the journal"
            : `Add ${drafts.length} trade${drafts.length === 1 ? "" : "s"} to the journal`}
        </Button>
        <span className="text-muted-foreground text-xs">
          Marked for review; times you leave empty stay unknown (no time-of-day stats) until you set
          them in the journal.
        </span>
      </div>
    </div>
  );
}

function chipLabel(f: BuildFill) {
  return `${f.side === "buy" ? "buy" : "sell"} ${f.qty} @ ${f.priceText}`;
}

function Chip({
  fill,
  qty,
  pressed,
  onClick,
}: {
  fill: BuildFill;
  qty: number;
  pressed: boolean;
  onClick: () => void;
}) {
  const buy = fill.side === "buy";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${buy ? "Buy" : "Sell"} ${qty}${qty !== fill.qty ? ` of ${fill.qty}` : ""} at ${fill.priceText}`}
      onClick={onClick}
      className={cn(
        "num focus-visible:ring-ring/50 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-[3px]",
        pressed ? "border-primary bg-primary/15" : "bg-background hover:bg-accent",
      )}
    >
      <span className={cn("mr-1 font-semibold", buy ? "text-foreground" : "text-muted-foreground")}>
        {buy ? "B" : "S"}
      </span>
      {qty}
      {qty !== fill.qty && <span className="text-muted-foreground">/{fill.qty}</span>} @{" "}
      {fill.priceText}
    </button>
  );
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the draft just is not kept */
  }
}
function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
