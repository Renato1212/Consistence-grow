"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { logClientError } from "@/lib/client-errors";
import type { CodeMapRow } from "@/lib/data/statements";
import { createClient } from "@/lib/supabase/client";

const SCALES = [1, 0.1, 0.01, 0.001, 0.0001];

/** Map each broker product code to an instrument (and printed-price scale). */
export function CodeMapEditor({
  rows,
  instruments,
}: {
  rows: CodeMapRow[];
  instruments: { id: string; symbol: string; name: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="code-map">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 pr-3 font-normal">Code</th>
            <th className="py-1 pr-3 font-normal">Product</th>
            <th className="py-1 pr-3 font-normal">Instrument</th>
            <th className="py-1 pr-3 font-normal">Price scale</th>
            <th className="py-1 pr-3 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <CodeRow key={r.code} row={r} instruments={instruments} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeRow({
  row,
  instruments,
}: {
  row: CodeMapRow;
  instruments: { id: string; symbol: string; name: string }[];
}) {
  const router = useRouter();
  const [instrument, setInstrument] = useState(row.instrumentId ?? "");
  const [scale, setScale] = useState(String(row.priceScale));
  const [busy, setBusy] = useState(false);
  const dirty = instrument !== (row.instrumentId ?? "") || Number(scale) !== row.priceScale;

  async function save(reset = false) {
    setBusy(true);
    const supabase = createClient();
    const res = await supabase.rpc("map_statement_code", {
      p_code: row.code,
      p_instrument: reset || !instrument ? null : instrument,
      p_price_scale: Number(scale),
    } as never);
    setBusy(false);
    if (res.error) {
      logClientError("statements.map", res.error);
      toast.error("Not saved — retry.");
      return;
    }
    toast(reset ? `Code ${row.code} back to the default` : `Code ${row.code} mapped`);
    router.refresh();
  }

  return (
    <tr className="border-t" data-code={row.code}>
      <td className="num py-1.5 pr-3 font-medium">{row.code}</td>
      <td className="py-1.5 pr-3">
        {row.description}
        <span className="text-muted-foreground block text-xs">
          {row.statements} statement{row.statements === 1 ? "" : "s"} · last {row.lastSeen}
        </span>
      </td>
      <td className="py-1.5 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <NativeSelect
            aria-label={`Instrument for code ${row.code}`}
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
          >
            <option value="">— not mapped —</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.name}
              </option>
            ))}
          </NativeSelect>
          {row.mapped ? (
            <Badge variant="accent">yours</Badge>
          ) : row.symbol ? (
            <Badge variant="outline">default</Badge>
          ) : null}
          {row.mappingOk === false && <Badge variant="warn">size mismatch</Badge>}
          {row.mappingOk === true && <Badge variant="outline">size verified</Badge>}
        </div>
      </td>
      <td className="py-1.5 pr-3">
        <NativeSelect
          aria-label={`Price scale for code ${row.code}`}
          value={scale}
          onChange={(e) => setScale(e.target.value)}
        >
          {SCALES.map((s) => (
            <option key={s} value={String(s)}>
              × {s}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="py-1.5 pr-3">
        <div className="flex gap-1">
          <Button size="sm" disabled={!dirty || busy} onClick={() => save()}>
            Save
          </Button>
          {row.mapped && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(true)}>
              Reset
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
