"use client";

import * as React from "react";
import { RadioGroup } from "radix-ui";

import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  className?: string;
};

/**
 * Segmented single-choice control (radio group semantics, arrow-key navigable).
 * Large tap targets for one-handed phone use.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "default",
}: {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  label: string;
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? ""}
      onValueChange={(v) => onChange(v as T)}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "border-input text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md border font-medium transition-colors outline-none focus-visible:ring-[3px]",
            "data-[state=checked]:border-primary data-[state=checked]:bg-primary/15 data-[state=checked]:text-foreground",
            size === "sm" ? "h-8 px-2.5 text-xs" : "h-11 min-w-11 px-3 text-sm",
            o.className,
          )}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
