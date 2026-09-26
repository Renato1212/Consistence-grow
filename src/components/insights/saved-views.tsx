"use client";

import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { logClientError } from "@/lib/client-errors";
import type { SavedView } from "@/lib/data/insights";
import type { Filter } from "@/lib/insights/filters";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";

/** Named filters: save the current one, apply, delete (soft, with Undo). */
export function SavedViews({
  views: initial,
  filter,
  onApply,
}: {
  views: SavedView[];
  filter: Filter;
  onApply: (f: Filter) => void;
}) {
  const [views, setViews] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("saved_views")
      .insert({ name: n.slice(0, 80), filter: filter as unknown as { [key: string]: Json } })
      .select("id, name")
      .single();
    setBusy(false);
    if (error || !data) {
      logClientError("saved_views.insert", error);
      toast.error("View not saved — retry.");
      return;
    }
    setViews((v) =>
      [...v, { id: data.id, name: data.name, filter }].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setSaving(false);
    setName("");
    toast.success(`Saved view “${data.name}”`);
  }

  async function remove(view: SavedView) {
    const supabase = createClient();
    const { error } = await supabase
      .from("saved_views")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", view.id);
    if (error) {
      logClientError("saved_views.delete", error, { id: view.id });
      toast.error("Not deleted — retry.");
      return;
    }
    setViews((v) => v.filter((x) => x.id !== view.id));
    toast(`Deleted view “${view.name}”`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const res = await supabase
            .from("saved_views")
            .update({ deleted_at: null })
            .eq("id", view.id);
          if (res.error) toast.error("Undo failed — retry.");
          else
            setViews((v) =>
              v.some((x) => x.id === view.id)
                ? v
                : [...v, view].sort((a, b) => a.name.localeCompare(b.name)),
            );
        },
      },
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="views-button">
            <Bookmark aria-hidden />
            Views{views.length > 0 && ` (${views.length})`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1">
          {views.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 text-xs">
              No saved views yet. Set filters, then “Save view”.
            </p>
          ) : (
            <ul data-testid="views-list">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="hover:bg-accent focus-visible:bg-accent flex-1 truncate rounded-sm px-2 py-1.5 text-left text-sm outline-none"
                    onClick={() => {
                      onApply(v.filter);
                      setOpen(false);
                    }}
                  >
                    {v.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Delete view ${v.name}`}
                    onClick={() => remove(v)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="sm" onClick={() => setSaving(true)}>
        Save view
      </Button>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>
            Saves the current filters (date range, kinds and all constraints).
          </DialogDescription>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input
              autoFocus
              aria-label="View name"
              placeholder="e.g. DATA · first 15 min"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={busy || !name.trim()}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
