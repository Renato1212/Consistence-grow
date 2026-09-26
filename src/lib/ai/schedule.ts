/** When the analysis routine runs (Europe/Lisbon). Shown in the UI; the routines use the same times. */
export const AI_SCHEDULE = [
  { slot: "eu", days: "Mon–Fri", time: "06:40", label: "Pre-EU session analysis" },
  { slot: "us", days: "Mon–Fri", time: "12:40", label: "Pre-US session analysis" },
  { slot: "weekly", days: "Sat", time: "09:10", label: "Weekly review" },
] as const;

export const AI_SCHEDULE_TEXT =
  "Runs weekdays 06:40 (pre-EU) and 12:40 (pre-US), Saturdays 09:10 (weekly) Lisbon time — or tap “Run now” on the routine in the Claude app.";

/** Requests older than this without a result are shown as not processed. */
export const AI_STALE_HOURS = 48;
