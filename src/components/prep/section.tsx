"use client";

import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** Collapsible prep section (open by default). */
export function Section({
  id,
  title,
  aside,
  children,
  defaultOpen = true,
  required,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  required?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <section id={id} aria-labelledby={`${id}-title`} className="bg-card rounded-xl border">
        <div className="flex items-center gap-2 px-4 py-3">
          <CollapsibleTrigger className="group flex flex-1 items-center gap-2 text-left">
            <ChevronDown
              className="text-muted-foreground size-4 transition-transform group-data-[state=closed]:-rotate-90"
              aria-hidden
            />
            <h2 id={`${id}-title`} className="heading-caps text-xs">
              {title}
              {required && <span className="text-primary-ink ml-1">*</span>}
            </h2>
          </CollapsibleTrigger>
          {aside}
        </div>
        <CollapsibleContent className={cn("space-y-4 px-4 pb-4")}>{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
