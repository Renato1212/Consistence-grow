"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";

export type ActionItemView = { id: string; text: string };

/**
 * Open action items with Done / Drop (and Undo). They stay on Today and in
 * every prep until closed here, in the debrief, or in the weekly review.
 */
export function ActionItemsList({
  items: initial,
  title = "Open action items",
}: {
  items: ActionItemView[];
  title?: string;
}) {
  const [items, setItems] = useState(initial);
  if (items.length === 0) return null;

  async function close(item: ActionItemView, status: "done" | "dropped") {
    const supabase = createClient();
    const { error } = await supabase
      .from("action_items")
      .update({ status, closed_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) {
      logClientError("action_items.close", error, { id: item.id });
      toast.error("Not saved — retry.");
      return;
    }
    setItems((all) => all.filter((x) => x.id !== item.id));
    toast(status === "done" ? "Marked done" : "Dropped", {
      action: {
        label: "Undo",
        onClick: async () => {
          const res = await supabase
            .from("action_items")
            .update({ status: "open", closed_at: null })
            .eq("id", item.id);
          if (res.error) toast.error("Undo failed — retry.");
          else setItems((all) => (all.some((x) => x.id === item.id) ? all : [...all, item]));
        },
      },
    });
  }

  return (
    <section className="border-primary/40 rounded-xl border p-4" aria-label={title}>
      <h2 className="heading-caps mb-2 text-xs">{title}</h2>
      <ul className="space-y-1" data-testid="action-items">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm" data-testid="action-item">
            <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden />
            <span className="min-w-0 flex-1">{a.text}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => close(a, "done")}
              aria-label={`Mark "${a.text}" done`}
            >
              <Check aria-hidden />
              Done
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-7"
              onClick={() => close(a, "dropped")}
              aria-label={`Drop "${a.text}"`}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
