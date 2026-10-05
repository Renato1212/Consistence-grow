"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { HolidayCalendar } from "@/lib/calendar/holidays";
import { useNow } from "@/lib/hooks/use-now";
import { defaultRoutine, parseRoutine, type Routine } from "@/lib/routine/routine";
import { blocksForDay, type BlockInstance } from "@/lib/routine/schedule";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz, lisbonToday } from "@/lib/time";

const PREF_KEY = "cg:block-alerts";
const SENT_PREFIX = "cg:block-alert:";
const REFRESH_MS = 10 * 60_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: alerts just won't be remembered */
  }
}

/** On/off switch for block alerts, kept on this device. */
export function useBlockAlertsPref() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setOn(read(PREF_KEY) === "on"), 0);
    return () => clearTimeout(t);
  }, []);
  const set = useCallback(async (next: boolean) => {
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    write(PREF_KEY, next ? "on" : null);
    setOn(next);
    window.dispatchEvent(new Event("cg:block-alerts"));
  }, []);
  return { on, set };
}

/**
 * Alerts N minutes before each routine block starts (a toast, plus a system
 * notification when allowed). Works only while the app is open in a tab.
 */
export function BlockAlerts() {
  const [enabled, setEnabled] = useState(false);
  const [plan, setPlan] = useState<{ date: string; minutes: number; blocks: BlockInstance[] }>();
  const now = useNow(20_000);
  const loading = useRef(false);

  useEffect(() => {
    const sync = () => setEnabled(read(PREF_KEY) === "on");
    const t = setTimeout(sync, 0);
    window.addEventListener("cg:block-alerts", sync);
    window.addEventListener("storage", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("cg:block-alerts", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const supabase = createClient();
      const date = lisbonToday();
      const [st, hol] = await Promise.all([
        supabase.from("user_settings").select("routine").maybeSingle(),
        supabase
          .from("holidays")
          .select("date, market, name, early_close")
          .eq("date", date)
          .is("deleted_at", null),
      ]);
      if (st.error || hol.error) return;
      const routine: Routine = parseRoutine(st.data?.routine ?? null, defaultRoutine());
      const cal = new HolidayCalendar(
        (hol.data ?? []).map((h) => ({
          date: h.date,
          market: h.market as "US" | "UK",
          name: h.name,
          earlyClose: h.early_close ? h.early_close.slice(0, 5) : null,
        })),
      );
      setPlan({ date, minutes: routine.alertMinutes, blocks: blocksForDay(routine, date, cal) });
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || !plan || now === null || plan.minutes === 0) return;
    if (plan.date !== lisbonToday()) {
      void load();
      return;
    }
    for (const b of plan.blocks) {
      const start = Date.parse(b.startAt);
      const lead = start - now;
      if (lead > plan.minutes * 60_000 || lead < -60_000) continue;
      const key = `${SENT_PREFIX}${plan.date}:${b.key}`;
      if (read(key)) continue;
      write(key, "1");
      const body = `${b.title} at ${formatInTz(b.startAt, DISPLAY_TZ, "HH:mm")}`;
      toast(`Next: ${b.title}`, { description: body, duration: 30_000 });
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification(`Next: ${b.title}`, { body, tag: key });
      } catch {
        /* some mobile browsers only allow notifications from a service worker */
      }
    }
  }, [enabled, plan, now, load]);

  return null;
}
