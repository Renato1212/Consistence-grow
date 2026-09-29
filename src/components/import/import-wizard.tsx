"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { logClientError } from "@/lib/client-errors";
import type { ImportPreset } from "@/lib/data/import";
import { fmtTicks } from "@/lib/format";
import { parseCsv, type Csv } from "@/lib/import/csv";
import {
  DEFAULT_MAPPING,
  FILL_FIELDS,
  REQUIRED_FIELDS,
  guessColumns,
  mapRows,
  type FillField,
  type ImportInstrument,
  type ImportMapping,
} from "@/lib/import/parse";
import { planImport, rpcPayload, type ImportPlan } from "@/lib/import/plan";
import { TIMEZONES } from "@/lib/import/preset";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";

const FIELD_LABEL: Record<FillField, string> = {
  account: "Account",
  symbol: "Symbol *",
  side: "Buy/Sell",
  qty: "Quantity *",
  price: "Price *",
  time: "Time *",
  date: "Date (if separate)",
  fee: "Fee / commission",
  orderId: "Order / fill id",
};

const DATE_LABEL: Record<ImportMapping["dateFormat"], string> = {
  "auto-iso": "Auto (YYYY-MM-DD or MM/DD/YYYY)",
  mdy: "MM/DD/YYYY",
  dmy: "DD/MM/YYYY",
  ymd: "YYYY/MM/DD",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4" aria-label={title}>
      <h2 className="heading-caps text-xs">
        <span className="text-primary-ink">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

async function knownHashes(fillHashes: string[], tradeHashes: string[]) {
  const supabase = createClient();
  const fills = new Set<string>();
  const trades = new Set<string>();
  for (let i = 0; i < fillHashes.length; i += 200) {
    const { data, error } = await supabase
      .from("fills")
      .select("hash")
      .in("hash", fillHashes.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) fills.add(r.hash);
  }
  for (let i = 0; i < tradeHashes.length; i += 200) {
    const { data, error } = await supabase
      .from("trades")
      .select("import_hash")
      .in("import_hash", tradeHashes.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) if (r.import_hash) trades.add(r.import_hash);
  }
  return { fills, trades };
}

export function ImportWizard({
  instruments,
  presets: initialPresets,
}: {
  instruments: ImportInstrument[];
  presets: ImportPreset[];
}) {
  const [presets, setPresets] = useState(initialPresets);
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<Csv | null>(null);
  const [mapping, setMappingState] = useState<ImportMapping>(DEFAULT_MAPPING);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | "save" | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const setMapping = (m: ImportMapping) => {
    setMappingState(m);
    setPlan(null);
    setResult(null);
  };

  const mapped = useMemo(
    () => (csv ? mapRows(csv.headers, csv.rows, mapping, instruments) : null),
    [csv, mapping, instruments],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large (max 20 MB).");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.headers.length || !parsed.rows.length) {
      toast.error("No rows found in this file.");
      return;
    }
    setFileName(file.name);
    setCsv(parsed);
    const preset = presets.find((p) => p.id === presetId);
    const guessed = guessColumns(parsed.headers);
    setMapping(
      preset
        ? {
            ...preset.mapping,
            columns: Object.fromEntries(
              FILL_FIELDS.map((f) => {
                const h = preset.mapping.columns[f];
                return [f, h && parsed.headers.includes(h) ? h : guessed[f]];
              }),
            ),
          }
        : { ...mapping, columns: guessed },
    );
  }

  function applyPreset(id: string) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setPresetName(p.name);
    const cols = csv
      ? Object.fromEntries(
          FILL_FIELDS.map((f) => {
            const h = p.mapping.columns[f];
            return [f, h && csv.headers.includes(h) ? h : (mapping.columns[f] ?? null)];
          }),
        )
      : p.mapping.columns;
    setMapping({ ...p.mapping, columns: cols });
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    setBusy("save");
    const supabase = createClient();
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const payload = { name, mapping: mapping as unknown as { [key: string]: Json } };
    const res = existing
      ? await supabase
          .from("import_presets")
          .update(payload)
          .eq("id", existing.id)
          .select("id")
          .single()
      : await supabase.from("import_presets").insert(payload).select("id").single();
    setBusy(null);
    if (res.error || !res.data) {
      logClientError("import.preset", res.error);
      toast.error("Preset not saved — retry.");
      return;
    }
    const saved = { id: res.data.id, name, mapping };
    setPresets((all) =>
      [...all.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setPresetId(saved.id);
    toast.success(`Preset “${name}” saved`);
  }

  async function check() {
    if (!mapped) return;
    setBusy("check");
    try {
      setPlan(await planImport(mapped.fills, knownHashes));
    } catch (e) {
      logClientError("import.check", e);
      toast.error("Could not check against the journal — retry.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!plan || plan.create.length === 0) return;
    setBusy("import");
    const { data, error } = await createClient().rpc("import_trades", {
      p_trades: rpcPayload(plan.create) as unknown as Json,
    });
    setBusy(null);
    if (error) {
      logClientError("import.commit", error);
      toast.error(
        error.code === "23505"
          ? "Some fills were imported in the meantime — check again."
          : "Import failed — nothing was written. Retry.",
      );
      setPlan(null);
      return;
    }
    const r = data as { created: number; skipped: number };
    setResult(r);
    setPlan(null);
    toast.success(`${r.created} trade${r.created === 1 ? "" : "s"} imported`);
  }

  const missing = REQUIRED_FIELDS.filter((f) => !mapping.columns[f]);
  const symbolOptions = instruments.map((i) => i.symbol);

  return (
    <div className="grid max-w-4xl gap-4">
      <Step n={1} title="File">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Mapping preset</span>
            <NativeSelect
              aria-label="Mapping preset"
              className="w-56"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="">New mapping</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="hover:bg-accent inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <FileUp className="size-4" aria-hidden />
            {fileName ?? "Choose CSV file"}
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {csv && (
            <span className="text-muted-foreground text-xs" data-testid="import-rows">
              {csv.rows.length} rows · {csv.headers.length} columns · delimiter “
              {csv.delimiter === "\t" ? "tab" : csv.delimiter}”
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Export the fills (executions) from your platform — one row per fill. Round trips are built
          here, flat to flat, per account and instrument.
        </p>
      </Step>

      {csv && (
        <Step n={2} title="Columns">
          <div className="grid gap-3 sm:grid-cols-3">
            {FILL_FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs">{FIELD_LABEL[f]}</span>
                <NativeSelect
                  aria-label={`Column for ${FIELD_LABEL[f].replace(" *", "")}`}
                  value={mapping.columns[f] ?? ""}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      columns: { ...mapping.columns, [f]: e.target.value || null },
                    })
                  }
                >
                  <option value="">—</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Date format</span>
              <NativeSelect
                aria-label="Date format"
                value={mapping.dateFormat}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    dateFormat: e.target.value as ImportMapping["dateFormat"],
                  })
                }
              >
                {Object.entries(DATE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Times are in</span>
              <NativeSelect
                aria-label="Time zone of the file"
                value={mapping.timezone}
                onChange={(e) => setMapping({ ...mapping, timezone: e.target.value })}
              >
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Decimal separator</span>
              <NativeSelect
                aria-label="Decimal separator"
                value={mapping.decimal}
                onChange={(e) => setMapping({ ...mapping, decimal: e.target.value as "." | "," })}
              >
                <option value=".">Point (5000.25)</option>
                <option value=",">Comma (5000,25)</option>
              </NativeSelect>
            </label>
          </div>
          {!mapping.columns.side && (
            <p className="text-muted-foreground text-xs">
              No Buy/Sell column: a negative quantity is read as a sell.
            </p>
          )}

          {mapped && mapped.unknownSymbols.length > 0 && (
            <div
              className="space-y-2 rounded-lg border border-dashed p-3"
              data-testid="unknown-symbols"
            >
              <p className="text-sm font-medium">
                Symbols not recognised — map them to an instrument:
              </p>
              {mapped.unknownSymbols.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <span className="num w-40 truncate">{s}</span>→
                  <NativeSelect
                    aria-label={`Instrument for ${s}`}
                    className="w-32"
                    value={mapping.symbolMap[s] ?? ""}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        symbolMap: e.target.value
                          ? { ...mapping.symbolMap, [s]: e.target.value }
                          : Object.fromEntries(
                              Object.entries(mapping.symbolMap).filter(([k]) => k !== s),
                            ),
                      })
                    }
                  >
                    <option value="">Skip</option>
                    {symbolOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Save this mapping as</span>
              <Input
                aria-label="Preset name"
                className="w-56"
                placeholder="e.g. Rithmic R|Trader Pro"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={savePreset}
              disabled={!presetName.trim() || busy === "save"}
            >
              <Save aria-hidden /> Save preset
            </Button>
          </div>
        </Step>
      )}

      {mapped && (
        <Step n={3} title="Preview">
          {missing.length > 0 ? (
            <p className="text-sm">
              Map the required columns (
              {missing.map((f) => FIELD_LABEL[f].replace(" *", "")).join(", ")}).
            </p>
          ) : (
            <>
              <p className="text-sm" data-testid="import-parsed">
                {mapped.fills.length} fills read · {mapped.errors.length} row
                {mapped.errors.length === 1 ? "" : "s"} with errors
              </p>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="num w-full min-w-[640px] text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 text-left font-normal">Row</th>
                      <th className="text-left font-normal">Time (Lisbon)</th>
                      <th className="text-left font-normal">Account</th>
                      <th className="text-left font-normal">Symbol</th>
                      <th className="text-left font-normal">Side</th>
                      <th className="text-right font-normal">Qty</th>
                      <th className="text-right font-normal">Price</th>
                      <th className="text-right font-normal">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.fills.slice(0, 20).map((f) => (
                      <tr key={f.row} className="border-b last:border-0">
                        <td className="py-1">{f.row}</td>
                        <td>{formatInTz(f.at, DISPLAY_TZ, "dd MMM yyyy HH:mm:ss")}</td>
                        <td>{f.account}</td>
                        <td>
                          {f.symbol} <span className="text-muted-foreground">{f.rawSymbol}</span>
                        </td>
                        <td>{f.side}</td>
                        <td className="text-right">{f.qty}</td>
                        <td className="text-right">{f.price}</td>
                        <td className="text-right">{f.fee ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mapped.errors.length > 0 && (
                <ul
                  className="text-muted-foreground space-y-0.5 text-xs"
                  data-testid="import-errors"
                >
                  {mapped.errors.slice(0, 10).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                  {mapped.errors.length > 10 && <li>…and {mapped.errors.length - 10} more</li>}
                </ul>
              )}
            </>
          )}
        </Step>
      )}

      {mapped && missing.length === 0 && mapped.fills.length > 0 && (
        <Step n={4} title="Check & import">
          {!plan && !result && (
            <Button onClick={check} disabled={busy !== null}>
              {busy === "check" && <Loader2 className="animate-spin" aria-hidden />}
              Check against the journal
            </Button>
          )}
          {plan && (
            <div className="space-y-3" data-testid="import-plan">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="accent" data-testid="plan-create">
                  {plan.create.length} new trade{plan.create.length === 1 ? "" : "s"}
                </Badge>
                <Badge variant="outline" data-testid="plan-duplicates">
                  {plan.duplicates.length} already imported
                </Badge>
                {mapped.errors.length > 0 && (
                  <Badge variant="warn">{mapped.errors.length} rows skipped</Badge>
                )}
                {plan.open.length > 0 && (
                  <Badge variant="warn" data-testid="plan-open">
                    {plan.open.length} open position{plan.open.length === 1 ? "" : "s"} not imported
                  </Badge>
                )}
              </div>
              {plan.open.map((o) => (
                <p
                  key={`${o.account}-${o.symbol}`}
                  className="text-muted-foreground flex items-center gap-1.5 text-xs"
                >
                  <AlertTriangle className="text-warn size-3.5" aria-hidden />
                  {o.account} · {o.symbol}: position of {o.qty} still open at the end of the file
                  (rows {o.fills.map((f) => f.row).join(", ")}).
                </p>
              ))}
              {plan.create.length > 0 && (
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="num w-full min-w-[560px] text-xs" data-testid="plan-trades">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 text-left font-normal">Entry (Lisbon)</th>
                        <th className="text-left font-normal">Account</th>
                        <th className="text-left font-normal">Trade</th>
                        <th className="text-right font-normal">Qty</th>
                        <th className="text-right font-normal">Entry → exit</th>
                        <th className="text-right font-normal">Move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.create.slice(0, 50).map((t) => {
                        const inst = instruments.find((i) => i.id === t.instrumentId);
                        const ticks = inst
                          ? ((t.exitPrice - t.entryPrice) * (t.direction === "long" ? 1 : -1)) /
                            inst.tickSize
                          : null;
                        return (
                          <tr key={t.importHash} className="border-b last:border-0">
                            <td className="py-1">
                              {formatInTz(t.entryAt, DISPLAY_TZ, "dd MMM yyyy HH:mm")}
                            </td>
                            <td>{t.account}</td>
                            <td>
                              {t.symbol} {t.direction}
                            </td>
                            <td className="text-right">{t.contracts}</td>
                            <td className="text-right">
                              {t.entryPrice} → {t.exitPrice}
                            </td>
                            <td className="text-right">
                              {ticks === null ? "—" : fmtTicks(Math.round(ticks * 100) / 100)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {plan.create.length > 50 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      …and {plan.create.length - 50} more
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={commit}
                  disabled={busy !== null || plan.create.length === 0}
                  data-testid="import-commit"
                >
                  {busy === "import" && <Loader2 className="animate-spin" aria-hidden />}
                  Import {plan.create.length} trade{plan.create.length === 1 ? "" : "s"}
                </Button>
                <Button variant="ghost" onClick={() => setPlan(null)} disabled={busy !== null}>
                  Cancel
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                One transaction: everything is imported or nothing is. Imported trades are marked
                “Needs review” until you set their domain.
              </p>
            </div>
          )}
          {result && (
            <div
              className="flex flex-wrap items-center gap-3 text-sm"
              role="status"
              data-testid="import-result"
            >
              <CheckCircle2 className="text-primary-ink size-5" aria-hidden />
              {result.created} imported{result.skipped ? `, ${result.skipped} already there` : ""}.
              <Button asChild variant="outline" size="sm">
                <Link href="/journal?review=1">Review imported trades</Link>
              </Button>
            </div>
          )}
        </Step>
      )}
    </div>
  );
}
