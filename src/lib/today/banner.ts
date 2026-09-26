export type BannerCandidate = {
  id: string;
  title: string;
  startsAt: string;
  importance: number;
};

/**
 * The "be flat" banner: the next high-importance (3) event starting within
 * `minutes`. It shows until the event time and then disappears.
 */
export function bannerEvent<T extends BannerCandidate>(
  nowMs: number,
  events: T[],
  minutes: number,
): { event: T; secondsLeft: number } | null {
  if (minutes <= 0) return null;
  let best: { event: T; secondsLeft: number } | null = null;
  for (const e of events) {
    if (e.importance < 3) continue;
    const secondsLeft = Math.ceil((Date.parse(e.startsAt) - nowMs) / 1000);
    if (secondsLeft <= 0 || secondsLeft > minutes * 60) continue;
    if (!best || secondsLeft < best.secondsLeft) best = { event: e, secondsLeft };
  }
  return best;
}

/** "7 min", "45 s" — minutes are rounded up so the banner never under-states. */
export function fmtCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}
