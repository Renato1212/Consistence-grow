"use client";

import { EventRowButton } from "@/components/calendar/calendar-view";
import { lisbonTime } from "@/lib/calendar/display";
import type { HolidayCalendar } from "@/lib/calendar/holidays";
import { sessionMarkers } from "@/lib/calendar/markers";
import type { CalendarEvent } from "@/lib/calendar/types";
import { DOMAINS } from "@/lib/domains";

/** A day's events grouped by edge domain, plus the session markers line. */
export function DayEvents({
  date,
  events,
  cal,
  onOpen,
  renderExtra,
}: {
  date: string;
  events: CalendarEvent[];
  cal: HolidayCalendar;
  onOpen?: (e: CalendarEvent) => void;
  renderExtra?: (e: CalendarEvent) => React.ReactNode;
}) {
  const markers = sessionMarkers(date, cal);
  const holidays = [cal.get(date, "US"), cal.get(date, "UK")].filter(Boolean);
  return (
    <div className="space-y-3" data-testid="day-events">
      {holidays.map((h) => (
        <p key={h!.market} className="rounded-md border border-amber-500/40 px-3 py-2 text-xs">
          {h!.market}: {h!.name}
          {h!.earlyClose ? ` — early close ${h!.earlyClose} local` : " — closed"}
        </p>
      ))}
      {markers.length > 0 && (
        <p className="text-muted-foreground num text-xs">
          {markers.map((m) => `${m.label} ${lisbonTime(m.at)}`).join(" · ")}
        </p>
      )}
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events on the calendar for this day.</p>
      ) : (
        DOMAINS.map((d) => {
          const list = events.filter((e) => e.primaryDomain === d.code);
          if (list.length === 0) return null;
          return (
            <div key={d.code} className="space-y-1">
              <h3 className={`heading-caps text-[10px] ${d.className}`}>{d.label}</h3>
              <ul className="divide-y rounded-lg border">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <EventRowButton event={e} onOpen={onOpen} />
                    </div>
                    {renderExtra?.(e)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
