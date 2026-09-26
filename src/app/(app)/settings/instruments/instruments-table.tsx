"use client";

import { useState } from "react";
import { Check, Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { logClientError } from "@/lib/client-errors";
import type { EditorInstrument } from "@/lib/data/editor";
import { createClient } from "@/lib/supabase/client";
import type { Update } from "@/lib/supabase/types";
import { parseDecimal } from "@/lib/trading/trade-form";
import { cn } from "@/lib/utils";

type RowState = "idle" | "saving" | "saved" | "error";

export function InstrumentsTable({ instruments }: { instruments: EditorInstrument[] }) {
  const [rows, setRows] = useState(instruments);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [specUnlocked, setSpecUnlocked] = useState(false);

  async function save(id: string, patch: Update<"instruments">) {
    setState((s) => ({ ...s, [id]: "saving" }));
    const { error } = await createClient().from("instruments").update(patch).eq("id", id);
    if (error) {
      logClientError("instruments.update", error, { id });
      setState((s) => ({ ...s, [id]: "error" }));
      toast.error("Not saved — retry.");
      return false;
    }
    setState((s) => ({ ...s, [id]: "saved" }));
    return true;
  }

  function numberField(
    inst: EditorInstrument,
    key: "feePerContract" | "tickSize" | "tickValue",
    column: "fee_per_contract" | "tick_size" | "tick_value",
    label: string,
  ) {
    return (
      <Input
        aria-label={`${inst.symbol} ${label}`}
        inputMode="decimal"
        defaultValue={String(inst[key])}
        className="num h-8 w-24 text-right"
        onBlur={async (e) => {
          const n = parseDecimal(e.target.value);
          const min = key === "feePerContract" ? 0 : Number.MIN_VALUE;
          if (n === "invalid" || n === null || n < min) {
            toast.error(
              `${inst.symbol}: ${label} must be a number${key === "feePerContract" ? " ≥ 0" : " > 0"}`,
            );
            e.target.value = String(inst[key]);
            return;
          }
          if (n === inst[key]) return;
          if (await save(inst.id, { [column]: n })) {
            setRows((all) => all.map((r) => (r.id === inst.id ? { ...r, [key]: n } : r)));
          } else {
            e.target.value = String(inst[key]);
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setSpecUnlocked((u) => !u)}>
          {specUnlocked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
          {specUnlocked ? "Lock contract specs" : "Edit tick size / value"}
        </Button>
      </div>
      {specUnlocked && (
        <p role="alert" className="rounded-md border border-amber-500/40 p-3 text-xs">
          Tick size and value drive every P&L calculation. Change them only if the exchange changed
          the contract. Existing trades keep the values they were saved with.
        </p>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="hidden sm:table-cell">Name</TableHead>
              <TableHead className="text-right">Fee / RT</TableHead>
              <TableHead className="text-right">Tick</TableHead>
              <TableHead className="text-right">Tick value</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>
                <span className="sr-only">Status</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((inst) => {
              const st = state[inst.id] ?? "idle";
              return (
                <TableRow
                  key={inst.id}
                  data-testid="instrument-row"
                  className={cn(!inst.active && "opacity-60")}
                >
                  <TableCell className="font-semibold">{inst.symbol}</TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                    {inst.name}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">
                        {inst.currency === "EUR" ? "€" : "$"}
                      </span>
                      {numberField(inst, "feePerContract", "fee_per_contract", "fee per contract")}
                    </span>
                  </TableCell>
                  <TableCell className="num text-right">
                    {specUnlocked
                      ? numberField(inst, "tickSize", "tick_size", "tick size")
                      : inst.tickSize}
                  </TableCell>
                  <TableCell className="num text-right">
                    {specUnlocked
                      ? numberField(inst, "tickValue", "tick_value", "tick value")
                      : inst.tickValue}
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`${inst.symbol} active`}
                      className="accent-primary size-4"
                      checked={inst.active}
                      onChange={async (e) => {
                        const active = e.target.checked;
                        const setActive = (v: boolean) =>
                          setRows((all) =>
                            all.map((r) => (r.id === inst.id ? { ...r, active: v } : r)),
                          );
                        setActive(active); // optimistic; rolled back if the save fails
                        if (!(await save(inst.id, { active }))) setActive(!active);
                      }}
                    />
                  </TableCell>
                  <TableCell className="w-6">
                    {st === "saving" && (
                      <Loader2 className="size-3.5 animate-spin" aria-label="Saving" />
                    )}
                    {st === "saved" && (
                      <Check className="text-profit size-3.5" aria-label="Saved" />
                    )}
                    {st === "error" && <span className="text-destructive text-xs">Error</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
