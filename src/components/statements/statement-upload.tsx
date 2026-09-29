"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileUp,
  Loader2,
  RefreshCw,
  Save,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { fmtMoney, pnlClass } from "@/lib/format";
import type { StatementPayload } from "@/lib/statements/payload";
import type { ExistingInfo, PreviewMapping } from "@/lib/statements/server";
import { cn } from "@/lib/utils";

type Preview = Omit<StatementPayload, "raw_text" | "fills">;

type Item = {
  key: string;
  file: File;
  phase: "reading" | "ready" | "saving" | "saved" | "error";
  preview?: Preview;
  existing?: ExistingInfo;
  mappings?: PreviewMapping[];
  error?: string;
  saved?: { status: string; id: string };
};

async function post(file: File, mode: "preview" | "save", replace = false) {
  const body = new FormData();
  body.set("file", file);
  body.set("mode", mode);
  if (replace) body.set("replace", "1");
  const res = await fetch("/api/statements", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export function StatementUpload() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function addFiles(list: FileList | File[] | null | undefined) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const fresh = files.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      phase: "reading" as const,
    }));
    setItems((xs) => [...fresh, ...xs]);
    // One at a time: parsing is CPU-bound on the server.
    for (const it of fresh) {
      try {
        const { status, json } = await post(it.file, "preview");
        if (status !== 200 || !json.ok) {
          patch(it.key, {
            phase: "error",
            error: (json.error as string) ?? "Could not read the statement — retry",
          });
          continue;
        }
        patch(it.key, {
          phase: "ready",
          preview: json.preview as Preview,
          existing: json.existing as ExistingInfo,
          mappings: json.mappings as PreviewMapping[],
        });
      } catch (e) {
        logClientError("statements.preview", e);
        patch(it.key, { phase: "error", error: "Network error — retry" });
      }
    }
  }

  async function save(it: Item, replace = false) {
    patch(it.key, { phase: "saving" });
    try {
      const { status, json } = await post(it.file, "save", replace);
      if (status === 409) {
        patch(it.key, { phase: "ready" });
        return;
      }
      if (!json.ok) {
        patch(it.key, {
          phase: "ready",
          error: (json.error as string) ?? "Could not store the statement — retry",
        });
        return;
      }
      patch(it.key, {
        phase: "saved",
        error: undefined,
        saved: { status: json.status as string, id: json.id as string },
      });
    } catch (e) {
      logClientError("statements.save", e);
      patch(it.key, { phase: "ready", error: "Network error — retry" });
    }
  }

  const saveable = items.filter((i) => i.phase === "ready" && i.existing?.state === "new");

  return (
    <div className="grid gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <FileUp className="text-muted-foreground size-8" aria-hidden />
        <p className="text-sm">
          Drop your Axia <strong>Daily Detail Statement</strong> PDFs here — several at once to
          backfill.
        </p>
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          Choose PDF files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          aria-label="Statement PDF files"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-muted-foreground max-w-lg text-xs">
          Each file is read on the server and checked (every product adds up, the summary matches,
          cash rolls from open to close) before you save it. Nothing is stored until you press Save.
        </p>
      </div>

      {saveable.length > 1 && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={async () => {
              for (const it of saveable) await save(it);
            }}
            data-testid="save-all"
          >
            <Save aria-hidden />
            Save all {saveable.length} new statements
          </Button>
        </div>
      )}

      <ul className="grid gap-3" data-testid="statement-previews">
        {items.map((it) => (
          <li key={it.key}>
            <PreviewCard
              item={it}
              onSave={(replace) => void save(it, replace)}
              onRemove={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewCard({
  item,
  onSave,
  onRemove,
}: {
  item: Item;
  onSave: (replace: boolean) => void;
  onRemove: () => void;
}) {
  const [showChecks, setShowChecks] = useState(false);
  const p = item.preview;
  const errors = p?.checks.filter((c) => !c.ok && c.severity === "error") ?? [];
  const warnings = p?.checks.filter((c) => !c.ok && c.severity === "warning") ?? [];
  const unmapped = item.mappings?.filter((m) => !m.symbol) ?? [];
  const badMapping = item.mappings?.filter((m) => m.ok === false) ?? [];

  return (
    <article className="bg-card rounded-lg border p-4" data-testid="statement-preview">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground truncate text-xs">{item.file.name}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          onClick={onRemove}
          aria-label={`Remove ${item.file.name}`}
        >
          <X aria-hidden />
        </Button>
      </header>

      {item.phase === "reading" && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading…
        </p>
      )}
      {item.phase === "error" && (
        <p className="text-loss flex items-center gap-2 text-sm" role="alert">
          <AlertTriangle className="size-4" aria-hidden /> {item.error}
        </p>
      )}

      {p && (
        <div className="mt-1 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">
              {p.trade_date} · {p.account}
            </h3>
            {p.program && <Badge variant="outline">{p.program}</Badge>}
            {p.simulated && <Badge>Simulated</Badge>}
            {errors.length ? (
              <Badge variant="warn" data-testid="preview-status">
                Needs attention · {errors.length} check{errors.length === 1 ? "" : "s"} failed
              </Badge>
            ) : (
              <Badge variant="accent" data-testid="preview-status">
                <CheckCircle2 className="size-3" aria-hidden /> All {p.checks.length} checks passed
              </Badge>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Stat label="Realized P/L">
              <span className={cn("num", pnlClass(p.realized_pnl))} data-testid="preview-realized">
                {fmtMoney(p.realized_pnl, p.currency)}
              </span>
            </Stat>
            <Stat label="Fees">
              <span className="num">{fmtMoney(-p.total_fees, p.currency)}</span>
            </Stat>
            <Stat label="Net liquid value">
              <span className="num">
                {p.net_liquid_value === null
                  ? "—"
                  : p.net_liquid_value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </Stat>
            <Stat label="Contracts · fills">
              <span className="num">
                {p.contracts} · {p.fills_count}
              </span>
            </Stat>
          </dl>

          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Products">
            {p.products.map((prod) => {
              const m = item.mappings?.find((x) => x.code === prod.code);
              return (
                <li
                  key={`${prod.code}-${prod.contract}`}
                  className="bg-muted/40 flex items-center gap-1.5 rounded border px-2 py-1"
                >
                  <span className="font-medium">{m?.symbol ?? `code ${prod.code}`}</span>
                  <span className="text-muted-foreground">{prod.contract}</span>
                  <span className={cn("num", pnlClass(prod.realized_pnl))}>
                    {fmtMoney(prod.realized_pnl, p.currency)}
                  </span>
                  {m?.source === "description" && <Badge variant="outline">guessed</Badge>}
                  {m?.ok === false && <Badge variant="warn">size mismatch</Badge>}
                </li>
              );
            })}
          </ul>

          {(errors.length > 0 ||
            warnings.length > 0 ||
            unmapped.length > 0 ||
            badMapping.length > 0) && (
            <ul className="grid gap-1 text-xs" data-testid="preview-issues">
              {errors.map((c) => (
                <li key={c.id} className="text-loss flex gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  {c.label}
                  {c.detail ? ` — ${c.detail}` : ""}
                </li>
              ))}
              {warnings.map((c) => (
                <li key={c.id} className="flex gap-1.5 text-amber-500">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  {c.label}
                  {c.detail ? ` — ${c.detail}` : ""}
                </li>
              ))}
              {unmapped.map((m) => (
                <li key={m.code} className="flex gap-1.5 text-amber-500">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  Product code {m.code} has no instrument yet — map it in Settings → Statements
                  after saving.
                </li>
              ))}
              {badMapping.map((m) => (
                <li key={`bad-${m.code}`} className="flex gap-1.5 text-amber-500">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  Code {m.code} → {m.symbol}: the amounts imply a different contract size. Check the
                  mapping in Settings → Statements.
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="text-muted-foreground flex w-fit items-center gap-1 text-xs hover:underline"
            onClick={() => setShowChecks((v) => !v)}
            aria-expanded={showChecks}
          >
            <ChevronDown className={cn("size-3.5", showChecks && "rotate-180")} aria-hidden />
            {showChecks ? "Hide" : "Show"} all {p.checks.length} checks
          </button>
          {showChecks && (
            <ul className="grid gap-0.5 text-xs">
              {p.checks.map((c) => (
                <li key={c.id} className="flex gap-1.5">
                  <span className={c.ok ? "text-muted-foreground" : "text-amber-500"}>
                    {c.ok ? "✓" : "✗"}
                  </span>
                  {c.label}
                  {c.detail && <span className="text-muted-foreground">— {c.detail}</span>}
                </li>
              ))}
            </ul>
          )}

          <footer className="flex flex-wrap items-center gap-2 border-t pt-3">
            {item.phase === "saved" && item.saved ? (
              <p className="flex items-center gap-2 text-sm" data-testid="preview-saved">
                <CheckCircle2 className="text-primary size-4" aria-hidden />
                {item.saved.status === "replaced"
                  ? "Replaced (the old one is in the trash)"
                  : item.saved.status === "duplicate"
                    ? "Already imported"
                    : "Saved"}
                <Link className="underline" href={`/statements/${item.saved.id}`}>
                  Open
                </Link>
              </p>
            ) : item.existing?.state === "duplicate" ? (
              <p className="text-muted-foreground text-sm" data-testid="preview-duplicate">
                Already imported —{" "}
                <Link className="underline" href={`/statements/${item.existing.id}`}>
                  open it
                </Link>
              </p>
            ) : item.existing?.state === "conflict" ? (
              <div className="grid w-full gap-2" data-testid="preview-conflict">
                <p className="text-sm">
                  A different statement for this account and day is already stored.
                </p>
                {item.existing.changes.length > 0 && (
                  <table className="w-fit text-xs">
                    <tbody>
                      {item.existing.changes.map((c) => (
                        <tr key={c.field}>
                          <td className="text-muted-foreground pr-4">{c.field}</td>
                          <td className="num pr-2">{c.before ?? "—"}</td>
                          <td className="px-1">→</td>
                          <td className="num">{c.after ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onSave(true)}
                    disabled={item.phase === "saving"}
                  >
                    <RefreshCw aria-hidden />
                    Replace
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
                    Keep the stored one
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => onSave(false)}
                disabled={item.phase === "saving"}
                data-testid="preview-save"
              >
                {item.phase === "saving" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                Save statement
              </Button>
            )}
            {item.error && item.phase !== "error" && (
              <span className="text-loss text-xs" role="alert">
                {item.error}
              </span>
            )}
          </footer>
        </div>
      )}
    </article>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
