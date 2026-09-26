"use client";

import { useSyncExternalStore } from "react";

import { DISPLAY_TZ, SECONDARY_CLOCKS, formatInTz } from "@/lib/time";

const TICK_MS = 15_000;

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}

// Snapshot changes once per tick so React re-renders at most every 15 s.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => null;

/** Lisbon wall clock plus the New York secondary clock. */
export function Clock() {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const secondary = SECONDARY_CLOCKS[0];

  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs" aria-live="off">
      <span title="Lisbon">
        <span className="mr-1">LIS</span>
        <span className="num text-foreground">
          {now === null ? "--:--" : formatInTz(now, DISPLAY_TZ, "HH:mm")}
        </span>
      </span>
      <span title={secondary.label} className="hidden sm:inline">
        <span className="mr-1">{secondary.short}</span>
        <span className="num">
          {now === null ? "--:--" : formatInTz(now, secondary.id, "HH:mm")}
        </span>
      </span>
    </div>
  );
}
