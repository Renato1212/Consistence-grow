import { redirect } from "next/navigation";

import { addDays, isWeekend } from "@/lib/calendar/dates";
import { loadHolidayCalendar, loadSettings } from "@/lib/data/calendar";
import { currentPrepSession, todayState } from "@/lib/today/state";

/** `P` shortcut target: the prep that matters right now. */
export default async function CurrentPrep() {
  const [cal, settings] = await Promise.all([loadHolidayCalendar(), loadSettings()]);
  const state = todayState(new Date(), cal, settings);
  if (state.phase === "closed" && isWeekend(state.date)) {
    let d = state.date;
    while (isWeekend(d)) d = addDays(d, 1);
    redirect(`/prep/${d}/eu`);
  }
  redirect(`/prep/${state.date}/${currentPrepSession(state).toLowerCase()}`);
}
