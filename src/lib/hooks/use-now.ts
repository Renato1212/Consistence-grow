"use client";

import { useEffect, useState } from "react";

/**
 * Current time, ticking every `intervalMs`. Null until mounted so server and
 * client render the same markup (no hydration mismatch on countdowns).
 */
export function useNow(intervalMs = 15_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
