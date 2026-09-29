"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/form/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { tzShort } from "@/lib/calendar/display";
import { HolidayCalendar, MARKETS, type Holiday, type Market } from "@/lib/calendar/holidays";
import { WEEKDAY_NAMES, type CalendarTemplate } from "@/lib/calendar/templates";
import { logClientError } from "@/lib/client-errors";
import type { AppSettings } from "@/lib/data/calendar";
import { createClient } from "@/lib/supabase/client";
import type { Update } from "@/lib/supabase/types";

type SaveState = "idle" | "saving" | "saved" | "error";

function StateIcon({ state }: { state: SaveState }) {
  if (state === "saving") return <Loader2 className="size-3.5 animate-spin" aria-label="Saving" />;
  if (state === "saved") return <Check className="text-profit size-3.5" aria-label="Saved" />;
  if (state === "error") return <span className="text-destructive text-xs">Error — retry</span>;
  return null;
}

const TIME_FIELDS: {
  key: keyof AppSettings;
  column: keyof Update<"user_settings">;
  label: string;
  tz: string;
}[] = [
  { key: "euPrepBy", column: "eu_prep_by", label: "EU prep done by", tz: "Europe/Lisbon" },
  {
    key: "euSessionStart",
    column: "eu_session_start",
    label: "EU session starts",
    tz: "Europe/London",
  },
  {
    key: "usSessionStart",
    column: "us_session_start",
    label: "US session starts",
    tz: "America/New_York",
  },
  {
    key: "usSessionEnd",
    column: "us_session_end",
    label: "US session ends",
    tz: "America/New_York",
  },
];

export function CalendarSettings({
  settings,
  templates: initialTemplates,
  holidays: initialHolidays,
  thisYear,
}: {
  settings: AppSettings;
  templates: CalendarTemplate[];
  holidays: (Holiday & { id: string })[];
  thisYear: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, SaveState>>({});
  const [templates, setTemplates] = useState(initialTemplates);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [newHoliday, setNewHoliday] = useState({
    date: "",
    market: "US" as Market,
    name: "",
    earlyClose: "",
  });
  const supabase = createClient();

  async function saveSetting(key: string, patch: Update<"user_settings">) {
    setState((s) => ({ ...s, [key]: "saving" }));
    const { error } = await supabase.from("user_settings").update(patch).not("id", "is", null);
    if (error) {
      logClientError("settings.calendar", error, { key });
      setState((s) => ({ ...s, [key]: "error" }));
      toast.error("Not saved — retry.");
      return;
    }
    setState((s) => ({ ...s, [key]: "saved" }));
    router.refresh();
  }

  const cal = new HolidayCalendar(holidays);
  const staleMarkets = (Object.keys(MARKETS) as Market[]).filter(
    (m) => (cal.lastYear(m) ?? 0) < thisYear + 1,
  );

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Session times</CardTitle>
          <CardDescription>
            Each time is defined in its own zone, so EU/US daylight-saving gaps are handled
            automatically. Changes apply to trades saved afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {TIME_FIELDS.map((f) => (
            <Field key={f.key} id={`set-${f.key}`} label={`${f.label} (${tzShort(f.tz)})`}>
              <div className="flex items-center gap-2">
                <Input
                  id={`set-${f.key}`}
                  type="time"
                  className="w-32"
                  defaultValue={String(settings[f.key])}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (!/^\d{2}:\d{2}$/.test(v)) {
                      e.target.value = String(settings[f.key]);
                      return;
                    }
                    if (v !== settings[f.key]) void saveSetting(f.key, { [f.column]: v });
                  }}
                />
                <StateIcon state={state[f.key] ?? "idle"} />
              </div>
            </Field>
          ))}
          <Field
            id="set-banner"
            label="Be-flat banner (minutes before high-impact events, 0 = off)"
          >
            <div className="flex items-center gap-2">
              <Input
                id="set-banner"
                type="number"
                min={0}
                max={120}
                className="w-24"
                defaultValue={settings.eventBannerMinutes}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isInteger(n) || n < 0 || n > 120) {
                    toast.error("Minutes must be a whole number from 0 to 120");
                    e.target.value = String(settings.eventBannerMinutes);
                    return;
                  }
                  if (n !== settings.eventBannerMinutes)
                    void saveSetting("banner", { event_banner_minutes: n });
                }}
              />
              <StateIcon state={state.banner ?? "idle"} />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurring releases</CardTitle>
          <CardDescription>
            Switch on the weekly releases you want on your calendar. Weeks with a US holiday are
            flagged — agencies often move those releases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  aria-label={`${t.title} on calendar`}
                  checked={t.active}
                  onChange={async (e) => {
                    const active = e.target.checked;
                    const set = (v: boolean) =>
                      setTemplates((all) =>
                        all.map((x) => (x.id === t.id ? { ...x, active: v } : x)),
                      );
                    set(active);
                    setState((s) => ({ ...s, [t.id]: "saving" }));
                    const { error } = await supabase
                      .from("calendar_templates")
                      .update({ active })
                      .eq("id", t.id);
                    if (error) {
                      set(!active);
                      logClientError("settings.template", error, { id: t.id });
                      setState((s) => ({ ...s, [t.id]: "error" }));
                      toast.error("Not saved — retry.");
                    } else {
                      setState((s) => ({ ...s, [t.id]: "saved" }));
                    }
                  }}
                />
                <span className="flex-1">{t.title}</span>
                <span className="num text-muted-foreground text-xs">
                  {WEEKDAY_NAMES[t.weekday]} {t.localTime.slice(0, 5)} {tzShort(t.tz)}
                </span>
                <StateIcon state={state[t.id] ?? "idle"} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exchange holidays</CardTitle>
          <CardDescription>
            Used for OPEX, VIX expiry, month-end and session times. Seeded from the NYSE and GOV.UK
            calendars for 2026–2027 — review every year.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {staleMarkets.length > 0 && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md border border-amber-500/40 p-3 text-xs"
            >
              <AlertTriangle className="text-warn size-4" aria-hidden />
              Add next year&apos;s holidays for {staleMarkets.join(" and ")} — generated dates may
              be wrong without them.
            </p>
          )}
          <form
            className="grid items-end gap-2 sm:grid-cols-[9rem_7rem_1fr_6rem_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              const h = newHoliday;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !h.name.trim()) {
                toast.error("Date and name are required.");
                return;
              }
              const { data, error } = await supabase
                .from("holidays")
                .insert({
                  date: h.date,
                  market: h.market,
                  name: h.name.trim(),
                  early_close: h.earlyClose || null,
                })
                .select("id")
                .single();
              if (error) {
                logClientError("settings.holiday.add", error);
                toast.error(
                  error.code === "23505"
                    ? "That market already has a holiday on that date."
                    : "Not saved — retry.",
                );
                return;
              }
              setHolidays((all) =>
                [
                  ...all,
                  {
                    id: data.id,
                    date: h.date,
                    market: h.market,
                    name: h.name.trim(),
                    earlyClose: h.earlyClose || null,
                  },
                ].sort((a, b) => a.date.localeCompare(b.date)),
              );
              setNewHoliday({ date: "", market: h.market, name: "", earlyClose: "" });
              toast.success("Holiday added");
              router.refresh();
            }}
          >
            <Field id="hol-date" label="Date">
              <Input
                id="hol-date"
                type="date"
                value={newHoliday.date}
                onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))}
              />
            </Field>
            <Field id="hol-market" label="Market">
              <NativeSelect
                id="hol-market"
                value={newHoliday.market}
                onChange={(e) => setNewHoliday((h) => ({ ...h, market: e.target.value as Market }))}
              >
                <option value="US">US</option>
                <option value="UK">UK</option>
              </NativeSelect>
            </Field>
            <Field id="hol-name" label="Name">
              <Input
                id="hol-name"
                value={newHoliday.name}
                onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
              />
            </Field>
            <Field id="hol-early" label="Early close">
              <Input
                id="hol-early"
                type="time"
                value={newHoliday.earlyClose}
                onChange={(e) => setNewHoliday((h) => ({ ...h, earlyClose: e.target.value }))}
              />
            </Field>
            <Button type="submit" variant="outline">
              <Plus aria-hidden />
              Add
            </Button>
          </form>
          <ul className="divide-y rounded-lg border" data-testid="holiday-list">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="num w-24 shrink-0">{h.date}</span>
                <span className="text-muted-foreground w-8 shrink-0 text-xs">{h.market}</span>
                <span className="min-w-0 flex-1 truncate">
                  {h.name}
                  {h.earlyClose && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      closes {h.earlyClose}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${h.name} ${h.date}`}
                  onClick={async () => {
                    const { error } = await supabase
                      .from("holidays")
                      .update({ deleted_at: new Date().toISOString() })
                      .eq("id", h.id);
                    if (error) {
                      logClientError("settings.holiday.remove", error, { id: h.id });
                      toast.error("Not removed — retry.");
                      return;
                    }
                    setHolidays((all) => all.filter((x) => x.id !== h.id));
                    toast(`Removed ${h.name}`, {
                      action: {
                        label: "Undo",
                        onClick: async () => {
                          const res = await supabase
                            .from("holidays")
                            .update({ deleted_at: null })
                            .eq("id", h.id);
                          if (res.error) toast.error("Undo failed — retry.");
                          else
                            setHolidays((all) =>
                              [...all, h].sort((a, b) => a.date.localeCompare(b.date)),
                            );
                        },
                      },
                    });
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
