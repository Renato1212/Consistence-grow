"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
        {hint && <span className="text-muted-foreground font-normal">{hint}</span>}
      </Label>
      {children}
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChipMulti({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; dot?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "border-input text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors outline-none focus-visible:ring-[3px]",
              on && "border-primary bg-primary/15 text-foreground",
            )}
          >
            {o.dot && <span className={cn("size-2 rounded-full", o.dot)} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
