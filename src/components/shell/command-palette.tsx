"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardPen, NotebookPen, Plus, Search } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ALL_NAV } from "@/lib/nav";
import { LOG_TRADE_HREF } from "./log-trade-fab";

const CHORD_TIMEOUT_MS = 1200;

/** True when the keystroke is aimed at a text field and must not be hijacked. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * ⌘K command palette plus global single-key shortcuts:
 *   N           → log trade
 *   P           → current session prep
 *   D           → today's debrief
 *   G then T/J/R/I/P/S → navigate
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const chordStartedAt = useRef<number | null>(null);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role='dialog']")) return;

      const key = e.key.toLowerCase();
      const now = Date.now();

      if (chordStartedAt.current !== null && now - chordStartedAt.current < CHORD_TIMEOUT_MS) {
        chordStartedAt.current = null;
        const target = ALL_NAV.find((item) => item.chord === key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      chordStartedAt.current = null;

      if (key === "g") {
        chordStartedAt.current = now;
      } else if (key === "n") {
        e.preventDefault();
        router.push(LOG_TRADE_HREF);
      } else if (key === "p") {
        e.preventDefault();
        router.push("/prep");
      } else if (key === "d") {
        e.preventDefault();
        router.push("/review/today");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground hidden gap-2 md:inline-flex"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
        Search
        <kbd className="num bg-muted rounded border px-1.5 text-[10px]">⌘K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open command palette"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Go to…" />
        <CommandList>
          <CommandEmpty>No match.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => go(LOG_TRADE_HREF)}>
              <Plus aria-hidden />
              Log trade
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/prep")}>
              <ClipboardPen aria-hidden />
              Session prep
              <CommandShortcut>P</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/review/today")}>
              <NotebookPen aria-hidden />
              Debrief
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/calendar")}>
              <CalendarDays aria-hidden />
              Calendar
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigate">
            {ALL_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.href} onSelect={() => go(item.href)}>
                  <Icon aria-hidden />
                  {item.label}
                  <CommandShortcut>G {item.chord.toUpperCase()}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
