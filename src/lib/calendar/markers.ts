import { zonedWallTimeToUtc } from "@/lib/time";

import { isWeekend, type IsoDate } from "./dates";
import type { HolidayCalendar } from "./holidays";
import type { SessionMarker } from "./types";

const NY = "America/New_York";
const FRANKFURT = "Europe/Berlin";

function minus10(time: string) {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m - 10;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Exchange session markers for a date — computed, never stored:
 * EU cash open 09:00 Frankfurt, US cash open 09:30 NY, NYSE closing-imbalance
 * publication / MOC cut-off 10 minutes before the close (15:50 NY), US cash
 * close 16:00 NY (or the early close).
 */
export function sessionMarkers(date: IsoDate, cal: HolidayCalendar): SessionMarker[] {
  if (isWeekend(date)) return [];
  const out: SessionMarker[] = [];
  const at = (time: string, tz: string) => zonedWallTimeToUtc(`${date} ${time}`, tz).toISOString();

  out.push({ key: "eu_open", label: "EU cash open", at: at("09:00", FRANKFURT), tz: FRANKFURT });
  if (!cal.isClosed(date, "US")) {
    const close = cal.earlyClose(date, "US") ?? "16:00";
    out.push({ key: "us_open", label: "US cash open", at: at("09:30", NY), tz: NY });
    out.push({ key: "moc", label: "MOC imbalance", at: at(minus10(close), NY), tz: NY });
    out.push({
      key: "us_close",
      label: close === "16:00" ? "US cash close" : "US cash close (early)",
      at: at(close, NY),
      tz: NY,
    });
  }
  return out;
}
