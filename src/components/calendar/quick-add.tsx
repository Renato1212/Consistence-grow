"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ChipMulti, Field } from "@/components/form/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { tzShort } from "@/lib/calendar/display";
import { PRESETS, presetEvents, type Preset } from "@/lib/calendar/presets";
import { logClientError } from "@/lib/client-errors";
import { createClient } from "@/lib/supabase/client";
import { notifyCalendarChanged } from "@/components/today/be-flat-banner";
import { DISPLAY_TZ, formatInTz, zonedWallTimeToUtc } from "@/lib/time";
import { deleteEventsWithUndo } from "./event-sheet";

const GROUPS: Preset["group"][] = ["US data", "Central banks", "Energy", "Rates"];

/** One click: pick a date, tap a preset → the event(s) exist, with Undo. */
export function QuickAddDialog({
  open,
  onOpenChange,
  defaultDate,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  onChanged: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState<string | null>(null);

  async function add(preset: Preset) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pick a date first.");
      return;
    }
    setBusy(preset.key);
    const rows = presetEvents(preset, date);
    const { data, error } = await createClient().from("calendar_events").insert(rows).select("id");
    setBusy(null);
    if (error) {
      logClientError("calendar.preset", error, { preset: preset.key });
      toast.error("Not added — retry.");
      return;
    }
    onChanged();
    notifyCalendarChanged();
    onOpenChange(false);
    const ids = (data ?? []).map((r) => r.id);
    toast.success(
      `Added ${preset.label} on ${formatInTz(rows[0].starts_at, DISPLAY_TZ, "EEE d MMM")}`,
      {
        action: {
          label: "Undo",
          onClick: () => void deleteEventsWithUndo(ids, preset.label, onChanged),
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="heading-caps text-base">Quick add</DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs">
          Presets fill in time (in the release&apos;s own zone), domain, importance and instruments.
          Edit anything afterwards.
        </DialogDescription>
        <Field id="qa-date" label="Date">
          <Input
            id="qa-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </Field>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <section key={g} className="space-y-2">
              <h3 className="heading-caps text-muted-foreground text-[11px]">{g}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => add(p)}
                    className="hover:border-primary/60 focus-visible:ring-ring/50 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-60"
                  >
                    <span className="truncate">{p.label}</span>
                    <span className="num text-muted-foreground shrink-0 text-xs">
                      {busy === p.key ? (
                        <Loader2 className="size-3.5 animate-spin" aria-label="Adding" />
                      ) : (
                        `${p.parts[0].time} ${tzShort(p.tz)}`
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function nowLisbon() {
  const now = new Date();
  return {
    date: formatInTz(now, DISPLAY_TZ, "yyyy-MM-dd"),
    time: formatInTz(now, DISPLAY_TZ, "HH:mm"),
  };
}

/** Log an unscheduled NEWS headline after the fact, so trades can link to it. */
export function HeadlineDialog({
  open,
  onOpenChange,
  symbols,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbols: string[];
  onChanged: () => void;
}) {
  const [initial] = useState(nowLisbon);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [importance, setImportance] = useState<"1" | "2" | "3">("2");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    const at = zonedWallTimeToUtc(`${date} ${time}`, DISPLAY_TZ);
    if (!title.trim() || Number.isNaN(at.getTime())) {
      toast.error("Headline and a valid time are required.");
      return;
    }
    setSaving(true);
    const { error } = await createClient()
      .from("calendar_events")
      .insert({
        title: title.trim(),
        starts_at: at.toISOString(),
        native_tz: DISPLAY_TZ,
        primary_domain: "NEWS",
        category: "Headline",
        importance: Number(importance),
        instruments,
        source: "headline",
      });
    setSaving(false);
    if (error) {
      logClientError("calendar.headline", error);
      toast.error("Not saved — retry.");
      return;
    }
    toast.success("Headline logged");
    onChanged();
    notifyCalendarChanged();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="heading-caps text-base">Log headline</DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs">
          Unscheduled news (NEWS domain). Time is Lisbon.
        </DialogDescription>
        <div className="space-y-4">
          <Field id="hl-title" label="Headline">
            <Input
              id="hl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tariff headline hits the wires"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="hl-date" label="Date">
              <Input
                id="hl-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field id="hl-time" label="Time (Lisbon)">
              <Input
                id="hl-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>
          <Field id="hl-importance" label="Importance">
            <Segmented
              label="Importance"
              size="sm"
              value={importance}
              onChange={setImportance}
              options={[
                { value: "1", label: "Low" },
                { value: "2", label: "Medium" },
                { value: "3", label: "High" },
              ]}
            />
          </Field>
          <Field id="hl-instruments" label="Instruments">
            <ChipMulti
              label="Instruments"
              value={instruments}
              onChange={setInstruments}
              options={symbols.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Log headline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
