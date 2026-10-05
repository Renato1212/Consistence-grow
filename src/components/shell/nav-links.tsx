"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Ellipsis } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MORE_NAV, PRIMARY_NAV, isActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

function MoreLinks({ pathname, onPick }: { pathname: string; onPick: () => void }) {
  return (
    <ul className="grid gap-0.5" aria-label="More pages">
      {MORE_NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onPick}
              aria-current={active ? "page" : undefined}
              className={cn(
                "hover:bg-accent flex h-11 items-center gap-3 rounded-md px-3 text-sm",
                active ? "text-primary-ink font-semibold" : "text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Desktop top navigation: the daily loop, then "More". */
export function TopNavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE_NAV.some((i) => isActive(pathname, i.href));
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {PRIMARY_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "heading-caps hover:text-foreground border-b-2 px-3 py-4 text-xs transition-colors",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground border-transparent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "heading-caps hover:text-foreground inline-flex items-center gap-1 border-b-2 px-3 py-4 text-xs transition-colors",
            moreActive
              ? "border-primary text-foreground"
              : "text-muted-foreground border-transparent",
          )}
        >
          More
          <ChevronDown className="size-3.5" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-52 p-1">
          <MoreLinks pathname={pathname} onPick={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </nav>
  );
}

/** Mobile bottom navigation: four daily pages and "More". */
export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE_NAV.some((i) => isActive(pathname, i.href));
  const cell = (active: boolean) =>
    cn(
      "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px]",
      active ? "text-primary-ink" : "text-muted-foreground",
    );
  return (
    <nav
      aria-label="Main"
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cell(active)}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className={cell(moreActive)}>
              <Ellipsis className="size-5" aria-hidden />
              More
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-56 p-1">
              <MoreLinks pathname={pathname} onPick={() => setOpen(false)} />
            </PopoverContent>
          </Popover>
        </li>
      </ul>
    </nav>
  );
}
