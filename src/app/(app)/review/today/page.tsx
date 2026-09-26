import { redirect } from "next/navigation";

import { addDays, isWeekend } from "@/lib/calendar/dates";
import { loadHolidayCalendar, loadSettings } from "@/lib/data/calendar";
import { todayState } from "@/lib/today/state";

/** `D` shortcut target: today's debrief, or the last weekday's at the weekend. */
export default async function DebriefToday() {
  const [cal, settings] = await Promise.all([loadHolidayCalendar(), loadSettings()]);
  let d = todayState(new Date(), cal, settings).date;
  while (isWeekend(d)) d = addDays(d, -1);
  redirect(`/review/${d}`);
}
