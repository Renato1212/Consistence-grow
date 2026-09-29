import {
  BookOpenText,
  CalendarCheck2,
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
  /** Hidden from the 5-slot mobile bottom bar (still in the top nav and palette). */
  desktopOnly?: boolean;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: CalendarCheck2, chord: "t" },
  { href: "/journal", label: "Journal", icon: NotebookPen, chord: "j" },
  { href: "/review", label: "Review", icon: ClipboardList, chord: "r" },
  { href: "/insights", label: "Insights", icon: LineChart, chord: "i" },
  { href: "/playbook", label: "Playbook", icon: BookOpenText, chord: "p" },
  { href: "/statements", label: "Statements", icon: Landmark, chord: "a", desktopOnly: true },
];

export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
  chord: "s",
};

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, SETTINGS_NAV];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
