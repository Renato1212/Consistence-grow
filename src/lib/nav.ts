import {
  BookOpenText,
  CalendarCheck2,
  CalendarDays,
  ClipboardList,
  Landmark,
  LineChart,
  NotebookPen,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the `G then …` navigation chord. */
  chord: string;
  /** Extra words the ⌘K palette matches. */
  keywords?: string[];
};

/** The daily loop: always one tap away (top bar and mobile bottom bar). */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: CalendarCheck2, chord: "t" },
  { href: "/journal", label: "Journal", icon: NotebookPen, chord: "j" },
  { href: "/review", label: "Review", icon: ClipboardList, chord: "r" },
  { href: "/playbook", label: "Setups", icon: BookOpenText, chord: "p", keywords: ["playbook"] },
];

/** Everything else, under "More". */
export const MORE_NAV: NavItem[] = [
  { href: "/insights", label: "Insights", icon: LineChart, chord: "i" },
  { href: "/statements", label: "Statements", icon: Landmark, chord: "a", keywords: ["broker"] },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, chord: "c", keywords: ["events"] },
  { href: "/settings", label: "Settings", icon: Settings, chord: "s" },
];

export const SETTINGS_NAV = MORE_NAV[3];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...MORE_NAV];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
