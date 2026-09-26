"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChipMulti, Field } from "@/components/form/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_CATEGORIES, EVENT_TZ_OPTIONS, lisbonTime } from "@/lib/calendar/display";
import type { CalendarEvent } from "@/lib/calendar/types";
import { logClientError } from "@/lib/client-errors";
import { DOMAINS, type DomainCode } from "@/lib/domains";
import { createClient } from "@/lib/supabase/client";
import { notifyCalendarChanged } from "@/components/today/be-flat-banner";
import { formatInTz, zonedWallTimeToUtc } from "@/lib/time";

type Draft = {
  title: string;
  date: string;
  time: string;
  tz: string;
  domain: DomainCode | "";
  category: string;
  importance: "1" | "2" | "3";
  instruments: string[];
  forecast: string;
  previous: string;
  actual: string;
  notes: string;
};

function toDraft(e: CalendarEvent | null, defaultDate: string): Draft {
  if (!e) {
    return {
      title: "",
      date: defaultDate,
      time: "08:30",
      tz: "America/New_York",
      domain: "DATA",
      category: "",
      importance: "2",
      instruments: [],
      forecast: "",
      previous: "",
      actual: "",
      notes: "",
    };
  }
  return {
    title: e.title,
    date: formatInTz(e.startsAt, e.nativeTz, "yyyy-MM-dd"),
    time: formatInTz(e.startsAt, e.nativeTz, "HH:mm"),
    tz: e.nativeTz,
    domain: e.primaryDomain,
    category: e.category,
    importance: String(e.importance) as Draft["importance"],
    instruments: e.instruments,
    forecast: e.forecast ?? "",
    previous: e.previous ?? "",
    actual: e.actual ?? "",
    notes: e.notes ?? "",
  };
}

function startsAtOf(d: Draft): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return null;
  const at = zonedWallTimeToUtc(`${d.date} ${d.time}`, d.tz);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Soft-delete events with an Undo toast. */
export async function deleteEventsWithUndo(ids: string[], label: string, onChange: () => void) {
  const supabase = createClient();
  const { error } = await supabase
    .from("calendar_events")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) {
    logClientError("calendar.delete", error, { ids });
    toast.error("Not deleted — retry.");
    return;
  }
  onChange();
  notifyCalendarChanged();
  toast(`Deleted ${label}`, {
    action: {
      label: "Undo",
      onClick: async () => {
        const res = await supabase
          .from("calendar_events")
          .update({ deleted_at: null })
          .in("id", ids);
        if (res.error) toast.error("Undo failed — retry.");
        else {
          onChange();
          notifyCalendarChanged();
        }
      },
    },
  });
}

/**
 * Create / edit one calendar event. Times are entered in the event's native
 * zone and shown in Lisbon. Generated FLOW events keep their computed time
 * and title; everything else stays editable.
 */
export function EventSheet({
  open,
  onOpenChange,
  event,
  defaultDate,
  symbols,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  defaultDate: string;
  symbols: string[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(event, defaultDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = event?.generated ?? false;
  const startsAt = startsAtOf(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const problems: string[] = [];
  if (!draft.title.trim()) problems.push("title");
  if (!startsAt) problems.push("date and time");
  if (!draft.domain) problems.push("domain");
  if (!draft.category.trim()) problems.push("category");

  async function save() {
    if (problems.length > 0 || !startsAt || !draft.domain) {
      setError(`Missing: ${problems.join(", ")}`);
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const common = {
      importance: Number(draft.importance),
      instruments: draft.instruments,
      forecast: draft.forecast.trim() || null,
      previous: draft.previous.trim() || null,
      actual: draft.actual.trim() || null,
      notes: draft.notes.trim() || null,
    };
    const editable = locked
      ? {}
      : {
          title: draft.title.trim(),
          starts_at: startsAt.toISOString(),
          native_tz: draft.tz,
          primary_domain: draft.domain,
          category: draft.category.trim(),
        };
    const res = event
      ? await supabase
          .from("calendar_events")
          .update({ ...common, ...editable })
          .eq("id", event.id)
      : await supabase.from("calendar_events").insert({
          ...common,
          title: draft.title.trim(),
          starts_at: startsAt.toISOString(),
          native_tz: draft.tz,
          primary_domain: draft.domain,
          category: draft.category.trim(),
          source: "manual",
        });
    setSaving(false);
    if (res.error) {
      logClientError("calendar.save", res.error, { id: event?.id ?? null });
      setError("Not saved — check your connection and retry.");
      return;
    }
    toast.success(event ? "Event updated" : "Event added");
    onChanged();
    notifyCalendarChanged();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto" data-testid="event-sheet">
        <div className="space-y-5 p-5 pb-10">
          <div className="space-y-1 pr-8">
            <SheetTitle className="heading-caps text-base">
              {event ? "Edit event" : "New event"}
            </SheetTitle>
            <SheetDescription className="text-muted-foreground text-xs">
              Enter the time in the event&apos;s own time zone — it is shown in Lisbon everywhere.
            </SheetDescription>
            {locked && (
              <Badge variant="outline" className="mt-1">
                Generated — time and title are computed
              </Badge>
            )}
          </div>

          <Field id="ev-title" label="Title">
            <Input
              id="ev-title"
              value={draft.title}
              disabled={locked}
              onChange={(e) => set("title", e.target.value)}
              placeholder="CPI"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field id="ev-date" label="Date">
              <Input
                id="ev-date"
                type="date"
                value={draft.date}
                disabled={locked}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field id="ev-time" label="Time">
              <Input
                id="ev-time"
                type="time"
                value={draft.time}
                disabled={locked}
                onChange={(e) => set("time", e.target.value)}
              />
            </Field>
            <Field id="ev-tz" label="Time zone">
              <NativeSelect
                id="ev-tz"
                value={draft.tz}
                disabled={locked}
                onChange={(e) => set("tz", e.target.value)}
              >
                {EVENT_TZ_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <p className="text-muted-foreground text-xs" data-testid="event-lisbon-time">
            {startsAt ? (
              <>
                = <span className="num text-foreground">{lisbonTime(startsAt.toISOString())}</span>{" "}
                Lisbon · {formatInTz(startsAt, "Europe/Lisbon", "EEE d MMM")}
              </>
            ) : (
              "Set a valid date and time."
            )}
          </p>

          <Field id="ev-domain" label="Domain">
            {locked ? (
              <p className="text-sm">FLOW</p>
            ) : (
              <Segmented
                label="Domain"
                size="sm"
                value={draft.domain}
                onChange={(v) => set("domain", v)}
                options={DOMAINS.map((d) => ({
                  value: d.code,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${d.bgClassName}`} aria-hidden />
                      {d.short}
                    </span>
                  ),
                }))}
              />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ev-category" label="Category">
              <Input
                id="ev-category"
                list="ev-categories"
                value={draft.category}
                disabled={locked}
                onChange={(e) => set("category", e.target.value)}
                placeholder="Inflation"
              />
              <datalist id="ev-categories">
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field id="ev-importance" label="Importance">
              <Segmented
                label="Importance"
                size="sm"
                value={draft.importance}
                onChange={(v) => set("importance", v)}
                options={[
                  { value: "1", label: "Low" },
                  { value: "2", label: "Medium" },
                  { value: "3", label: "High" },
                ]}
              />
            </Field>
          </div>

          <Field id="ev-instruments" label="Affected instruments">
            <ChipMulti
              label="Affected instruments"
              value={draft.instruments}
              onChange={(v) => set("instruments", v)}
              options={[...new Set([...symbols, ...draft.instruments])].map((s) => ({
                value: s,
                label: s,
              }))}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field id="ev-forecast" label="Forecast">
              <Input
                id="ev-forecast"
                value={draft.forecast}
                onChange={(e) => set("forecast", e.target.value)}
              />
            </Field>
            <Field id="ev-previous" label="Previous">
              <Input
                id="ev-previous"
                value={draft.previous}
                onChange={(e) => set("previous", e.target.value)}
              />
            </Field>
            <Field id="ev-actual" label="Actual">
              <Input
                id="ev-actual"
                value={draft.actual}
                onChange={(e) => set("actual", e.target.value)}
              />
            </Field>
          </div>

          <Field id="ev-notes" label="Notes">
            <Textarea
              id="ev-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {error && !saving ? "Retry" : "Save event"}
            </Button>
            {event && (
              <Button
                variant="ghost"
                className="text-muted-foreground ml-auto"
                onClick={async () => {
                  onOpenChange(false);
                  await deleteEventsWithUndo([event.id], event.title, onChanged);
                }}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
