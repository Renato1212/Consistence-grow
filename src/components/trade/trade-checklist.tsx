"use client";

import { useEffect, useState } from "react";
import { CheckSquare } from "lucide-react";

import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; text: string };

/**
 * The linked playbook's pre-entry checklist. Nothing is stored until the
 * first tick; from then on every item is recorded (ticked or not) so
 * adherence stats are honest.
 */
export function TradeChecklist({
  playbookId,
  value,
  onChange,
}: {
  playbookId: string;
  value: Record<string, boolean>;
  onChange: (v: Record<string, boolean>) => void;
}) {
  const [loaded, setLoaded] = useState<{ playbookId: string; items: Item[] } | null>(null);

  useEffect(() => {
    if (!playbookId) return;
    let cancelled = false;
    createClient()
      .from("playbook_checklist_items")
      .select("id, text")
      .eq("playbook_id", playbookId)
      .is("deleted_at", null)
      .order("sort")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          logClientError("trade.checklist", error, { playbookId });
          return;
        }
        setLoaded({ playbookId, items: data ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [playbookId]);

  const items = loaded && loaded.playbookId === playbookId ? loaded.items : [];
  if (!playbookId || items.length === 0) return null;
  const ticked = items.filter((i) => value[i.id]).length;

  return (
    <fieldset className="bg-muted/30 space-y-2 rounded-lg border p-3" data-testid="trade-checklist">
      <legend className="flex items-center gap-1.5 px-1 text-xs font-medium">
        <CheckSquare className="size-3.5" aria-hidden />
        Pre-entry checklist
        <span className="num text-muted-foreground">
          {ticked}/{items.length}
        </span>
      </legend>
      {items.map((i) => (
        <label key={i.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary mt-0.5 size-4"
            checked={value[i.id] ?? false}
            onChange={(e) =>
              onChange({
                ...Object.fromEntries(items.map((x) => [x.id, value[x.id] ?? false])),
                [i.id]: e.target.checked,
              })
            }
          />
          {i.text}
        </label>
      ))}
    </fieldset>
  );
}
