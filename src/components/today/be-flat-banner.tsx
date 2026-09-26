"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { lisbonTime } from "@/lib/calendar/display";
import { bannerEvent, fmtCountdown, type BannerCandidate } from "@/lib/today/banner";
import { useNow } from "@/lib/hooks/use-now";

const REFRESH_MS = 5 * 60_000;

/**
 * Standing rule, app-wide: N minutes before any high-importance scheduled
 * event, show "be flat". Reads the calendar directly (refreshed every 5 min
 * and when the tab regains focus), so it works on every page.
 */
export function BeFlatBanner() {
  const [events, setEvents] = useState<BannerCandidate[]>([]);
  const [minutes, setMinutes] = useState(10);
  const now = useNow(1000);

  const load = useCallback(async () => {
    const supabase = createClient();
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 26 * 3600_000).toISOString();
    const [ev, st] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("id, title, starts_at, importance")
        .is("deleted_at", null)
        .eq("importance", 3)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at")
        .limit(50),
      supabase.from("user_settings").select("event_banner_minutes").maybeSingle(),
    ]);
    // On a failed read keep the last known list: never hide a banner by accident.
    if (!ev.error) {
      setEvents(
        (ev.data ?? []).map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: e.starts_at,
          importance: e.importance,
        })),
      );
    }
    if (!st.error && st.data) setMinutes(st.data.event_banner_minutes);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("cg:calendar-changed", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("cg:calendar-changed", onFocus);
    };
  }, [load]);

  if (now === null) return null;
  const hit = bannerEvent(now, events, minutes);
  if (!hit) return null;
  return (
    <div
      role="alert"
      data-testid="be-flat-banner"
      className="bg-primary text-primary-foreground sticky top-14 z-30 border-b"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm font-bold tracking-wide uppercase">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          {hit.event.title} in {fmtCountdown(hit.secondsLeft)} — be flat
        </span>
        <span className="num ml-auto shrink-0 text-xs font-semibold">
          {lisbonTime(hit.event.startsAt)} Lisbon
        </span>
      </div>
    </div>
  );
}

/** Tell the banner the calendar changed (after adding/editing events). */
export function notifyCalendarChanged() {
  window.dispatchEvent(new Event("cg:calendar-changed"));
}
