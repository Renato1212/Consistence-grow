"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Image as ImageIcon,
  NotebookPen,
  Search,
} from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JournalTrade } from "@/lib/data/journal";
import { DOMAINS, domainMeta, type DomainCode } from "@/lib/domains";
import { fmtMoney, fmtR, pnlClass } from "@/lib/format";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PnlHeatmap } from "./pnl-heatmap";

type Filters = {
  q: string;
  kind: "" | JournalTrade["kind"];
  symbol: string;
  domain: "" | DomainCode;
  from: string;
  to: string;
  review: boolean;
};

const EMPTY: Filters = {
  q: "",
  kind: "",
  symbol: "",
  domain: "",
  from: "",
  to: "",
  review: false,
};

function isTypingTarget(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
  );
}

export function applyFilters(trades: JournalTrade[], f: Filters): JournalTrade[] {
  const q = f.q.trim().toLowerCase();
  return trades.filter((t) => {
    if (f.review && !t.needs_review) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.symbol && t.symbol !== f.symbol) return false;
    if (f.domain && t.primary_domain !== f.domain && !t.secondary_domains.includes(f.domain))
      return false;
    if (f.from && (t.trade_date ?? "") < f.from) return false;
    if (f.to && (t.trade_date ?? "") > f.to) return false;
    if (q) {
      const hay = [t.symbol, t.playbook_name, t.thesis, t.lesson, t.management, ...t.tag_names]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function DomainDot({ code }: { code: string | null }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  const d = domainMeta(code as DomainCode);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
      {d.short}
    </span>
  );
}

function Grades({ t }: { t: JournalTrade }) {
  if (!t.grade_context && !t.grade_edge && !t.grade_process)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="num text-xs" title="Context · Edge · Process">
      {t.grade_context ?? "·"}
      {t.grade_edge ?? "·"}
      {t.grade_process ?? "·"}
    </span>
  );
}

function KindBadge({ kind }: { kind: JournalTrade["kind"] }) {
  if (kind === "taken") return null;
  return <Badge variant="outline">{kind === "missed" ? "Missed" : "Observed"}</Badge>;
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
});
const helper = createColumnHelper<typeof features, JournalTrade>();

const columns = helper.columns([
  helper.accessor("entry_at", {
    header: "Date",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <span className="num text-xs">
        {formatInTz(row.original.entry_at, DISPLAY_TZ, "dd MMM HH:mm")}
      </span>
    ),
  }),
  helper.accessor("symbol", {
    header: "Instr.",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{row.original.symbol}</span>
        <KindBadge kind={row.original.kind} />
        {row.original.needs_review && <Badge variant="warn">Review</Badge>}
      </span>
    ),
  }),
  helper.accessor("direction", {
    header: "Dir",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.direction === "long" ? (
        <ArrowUpRight className="size-4" aria-label="Long" />
      ) : (
        <ArrowDownRight className="size-4" aria-label="Short" />
      ),
  }),
  helper.accessor("primary_domain", {
    header: "Domain",
    sortFn: "alphanumeric",
    cell: ({ row }) => <DomainDot code={row.original.primary_domain} />,
  }),
  helper.accessor("playbook_name", {
    header: "Playbook",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <span className="block max-w-40 truncate text-xs">{row.original.playbook_name ?? "—"}</span>
    ),
  }),
  helper.accessor((t) => t.r_multiple ?? undefined, {
    id: "r_multiple",
    header: "R",
    sortFn: "basic",
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.kind === "observed" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={cn("num", pnlClass(row.original.r_multiple))}>
          {fmtR(row.original.r_multiple)}
        </span>
      ),
  }),
  helper.accessor((t) => t.net_pnl ?? undefined, {
    id: "net_pnl",
    header: "Net",
    sortFn: "basic",
    sortUndefined: "last",
    cell: ({ row }) => (
      <span className={cn("num", pnlClass(row.original.net_pnl))}>
        {row.original.kind === "observed"
          ? "—"
          : fmtMoney(row.original.net_pnl, row.original.currency)}
      </span>
    ),
  }),
  helper.display({ id: "grades", header: "C·E·P", cell: ({ row }) => <Grades t={row.original} /> }),
  helper.display({
    id: "tags",
    header: "Tags",
    cell: ({ row }) => {
      const tags = row.original.tag_names;
      if (!tags.length) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="flex items-center gap-1">
          {tags.slice(0, 2).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {tags.length > 2 && (
            <span className="text-muted-foreground text-xs">+{tags.length - 2}</span>
          )}
        </span>
      );
    },
  }),
  helper.display({
    id: "media",
    header: () => <span className="sr-only">Media</span>,
    cell: ({ row }) =>
      row.original.media_count > 0 ? (
        <ImageIcon
          className="text-muted-foreground size-4"
          aria-label={`${row.original.media_count} media`}
        />
      ) : null,
  }),
]);

export function JournalView({
  trades,
  truncated,
  initialReview = false,
}: {
  trades: JournalTrade[];
  truncated: boolean;
  initialReview?: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, review: initialReview });
  const reviewCount = useMemo(() => trades.filter((t) => t.needs_review).length, [trades]);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => applyFilters(trades, filters), [trades, filters]);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const open = (id: string) => router.push(`/journal?trade=${id}`, { scroll: false });

  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { sorting: [{ id: "entry_at", desc: true }] },
  });

  if (trades.length === 0) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="No trades yet"
        description="Press N (or the Log trade button) to log your first one — taken, missed or observed."
      />
    );
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = rows.length !== trades.length;

  return (
    <div className="space-y-4">
      <PnlHeatmap
        trades={trades.map((t) => ({ ...t, net_pnl: t.net_pnl, r_multiple: t.r_multiple }))}
        onPickDay={(d) => set({ from: d, to: d })}
      />

      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter trades">
        <div className="relative min-w-48 flex-1">
          <Search
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={search}
            aria-label="Search trades (/)"
            placeholder="Search tags, playbook, notes…  ( / )"
            className="pl-8"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        {(reviewCount > 0 || filters.review) && (
          <button
            type="button"
            aria-pressed={filters.review}
            onClick={() => set({ review: !filters.review })}
            className={cn(
              "border-input text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]",
              filters.review && "border-primary bg-primary/15 text-foreground",
            )}
            data-testid="review-filter"
          >
            Needs review ({reviewCount})
          </button>
        )}
        <div className="w-32">
          <NativeSelect
            aria-label="Kind"
            value={filters.kind}
            onChange={(e) => set({ kind: e.target.value as Filters["kind"] })}
          >
            <option value="">All kinds</option>
            <option value="taken">Taken</option>
            <option value="missed">Missed</option>
            <option value="observed">Observed</option>
          </NativeSelect>
        </div>
        <div className="w-28">
          <NativeSelect
            aria-label="Instrument"
            value={filters.symbol}
            onChange={(e) => set({ symbol: e.target.value })}
          >
            <option value="">All instr.</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-36">
          <NativeSelect
            aria-label="Domain"
            value={filters.domain}
            onChange={(e) => set({ domain: e.target.value as Filters["domain"] })}
          >
            <option value="">All domains</option>
            {DOMAINS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.short}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Input
          type="date"
          aria-label="From date"
          className="w-38"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Input
          type="date"
          aria-label="To date"
          className="w-38"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        {filtered && (
          <button
            type="button"
            className="text-primary h-9 px-2 text-xs underline-offset-4 hover:underline"
            onClick={() => setFilters(EMPTY)}
          >
            Clear
          </button>
        )}
      </div>

      <p className="text-muted-foreground num text-xs" aria-live="polite">
        n={rows.length}
        {filtered && ` of ${trades.length}`}
        {truncated && " · showing the latest 2,000 trades"}
      </p>

      {/* Desktop table */}
      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={h} />
                        <ArrowUpDown className="size-3 opacity-50" aria-hidden />
                      </button>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={0}
                data-testid="journal-row"
                className="cursor-pointer"
                onClick={() => open(row.original.id)}
                onKeyDown={(e) => e.key === "Enter" && open(row.original.id)}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone cards */}
      <ul className="space-y-2 md:hidden">
        {table.getRowModel().rows.map(({ original: t }) => (
          <li key={t.id}>
            <button
              type="button"
              data-testid="journal-card"
              onClick={() => open(t.id)}
              className="bg-card flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1.5">
                  {t.direction === "long" ? (
                    <ArrowUpRight className="size-4" aria-label="Long" />
                  ) : (
                    <ArrowDownRight className="size-4" aria-label="Short" />
                  )}
                  <span className="font-medium">{t.symbol}</span>
                  <KindBadge kind={t.kind} />
                  {t.media_count > 0 && (
                    <ImageIcon className="text-muted-foreground size-3.5" aria-label="Has media" />
                  )}
                </div>
                <div className="text-muted-foreground num text-xs">
                  {formatInTz(t.entry_at, DISPLAY_TZ, "dd MMM HH:mm")} ·{" "}
                  <DomainDot code={t.primary_domain} />
                </div>
              </div>
              {t.kind !== "observed" && (
                <div className="text-right">
                  <div className={cn("num font-semibold", pnlClass(t.r_multiple))}>
                    {fmtR(t.r_multiple)}
                  </div>
                  <div className={cn("num text-xs", pnlClass(t.net_pnl))}>
                    {fmtMoney(t.net_pnl, t.currency)}
                  </div>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No trades match these filters.
        </p>
      )}
    </div>
  );
}
