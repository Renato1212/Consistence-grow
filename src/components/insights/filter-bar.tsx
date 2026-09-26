"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { DOMAIN_CODES } from "@/lib/domains";
import { DIMENSION_BY_KEY, displayValue } from "@/lib/insights/dimensions";
import {
  filterChips,
  KINDS,
  RANGE_LABEL,
  RANGES,
  type Filter,
  type FilterKey,
  type Kind,
} from "@/lib/insights/filters";
import type { InsightTrade, PlaybookRef } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

const MAIN: FilterKey[] = ["instrument", "direction", "domain", "playbook", "session"];
const MORE: FilterKey[] = [
  "secondary",
  "domainCount",
  "weekday",
  "timeBucket",
  "event",
  "eventType",
  "regime",
  "priorDay",
  "tag",
  "gradeContext",
  "gradeEdge",
  "gradeProcess",
  "confidence",
  "prep",
  "levelStrength",
  "exitReason",
];

const KIND_LABEL: Record<Kind, string> = { taken: "Taken", missed: "Missed", observed: "Observed" };

/** Options per filter: values present in the data plus the fixed vocabularies. */
function useOptions(trades: InsightTrade[], playbooks: PlaybookRef[]) {
  return useMemo(() => {
    const out = {} as Record<FilterKey, Option[]>;
    for (const key of [...MAIN, ...MORE]) {
      const dim = DIMENSION_BY_KEY[key];
      const seen = new Set<string>(
        key === "weekday" ? ["1", "2", "3", "4", "5"] : (dim.order ?? []),
      );
      if (key === "domain" || key === "secondary") DOMAIN_CODES.forEach((d) => seen.add(d));
      if (key === "playbook") playbooks.forEach((p) => seen.add(p.name));
      for (const t of trades) for (const v of dim.values(t)) seen.add(v);
      const values = [...seen];
      if (dim.order) values.sort((a, b) => dim.order!.indexOf(a) - dim.order!.indexOf(b));
      else values.sort((a, b) => a.localeCompare(b));
      out[key] = values.map((v) => ({ value: v, label: displayValue(key, v) }));
    }
    return out;
  }, [trades, playbooks]);
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const shown = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;
  const summary =
    value.length === 0
      ? "Any"
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length} selected`;
  return (
    <Popover onOpenChange={(o) => !o && setQ("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "border-input hover:bg-accent focus-visible:ring-ring/50 inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none focus-visible:ring-[3px]",
            value.length > 0 && "border-primary bg-primary/10",
          )}
          aria-label={`${label}: ${summary}`}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate font-medium">{summary}</span>
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {options.length > 8 && (
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label}`}
            className="mb-1 h-8"
          />
        )}
        <div role="group" aria-label={label} className="max-h-64 overflow-y-auto">
          {shown.length === 0 && (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">No values yet.</p>
          )}
          {shown.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])
                }
                className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    on && "border-primary bg-primary text-primary-foreground",
                  )}
                  aria-hidden
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({
  filter,
  onChange,
  trades,
  playbooks,
  views,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  trades: InsightTrade[];
  playbooks: PlaybookRef[];
  views: React.ReactNode;
}) {
  const options = useOptions(trades, playbooks);
  const moreActive = MORE.some((k) => filter.values[k]?.length);
  const [moreOpen, setMoreOpen] = useState(moreActive);
  const chips = filterChips(filter);

  const setValues = (key: FilterKey, v: string[]) => {
    const values = { ...filter.values, [key]: v };
    if (!v.length) delete values[key];
    onChange({
      ...filter,
      values,
      playbookVersion: key === "playbook" && v.length !== 1 ? null : filter.playbookVersion,
    });
  };

  const select = (key: FilterKey) => (
    <MultiSelect
      key={key}
      label={DIMENSION_BY_KEY[key].label}
      options={options[key]}
      value={filter.values[key] ?? []}
      onChange={(v) => setValues(key, v)}
    />
  );

  const onePlaybook =
    filter.values.playbook?.length === 1
      ? playbooks.find((p) => p.name === filter.values.playbook![0])
      : undefined;

  return (
    <div className="bg-card space-y-3 rounded-xl border p-3" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Date range"
          size="sm"
          value={filter.range}
          onChange={(range) => onChange({ ...filter, range })}
          options={RANGES.map((r) => ({
            value: r,
            label: r === "all" ? "All" : r === "custom" ? "Custom" : r.toUpperCase(),
          }))}
        />
        {filter.range === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From"
              className="h-8 w-36"
              value={filter.from ?? ""}
              onChange={(e) => onChange({ ...filter, from: e.target.value || null })}
            />
            <span className="text-muted-foreground text-xs">to</span>
            <Input
              type="date"
              aria-label="To"
              className="h-8 w-36"
              value={filter.to ?? ""}
              onChange={(e) => onChange({ ...filter, to: e.target.value || null })}
            />
          </div>
        )}
        <div role="group" aria-label="Kinds" className="flex gap-1.5">
          {KINDS.map((k) => {
            const on = filter.kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const kinds = on ? filter.kinds.filter((x) => x !== k) : [...filter.kinds, k];
                  if (kinds.length) onChange({ ...filter, kinds });
                }}
                className={cn(
                  "border-input text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 h-8 rounded-md border px-2.5 text-xs outline-none focus-visible:ring-[3px]",
                  on && "border-primary bg-primary/15 text-foreground",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto">{views}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {MAIN.map(select)}
        {onePlaybook && onePlaybook.version > 1 && (
          <NativeSelect
            aria-label="Playbook version"
            className="h-8 w-28 text-xs"
            value={filter.playbookVersion ?? ""}
            onChange={(e) =>
              onChange({
                ...filter,
                playbookVersion: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">All versions</option>
            {Array.from({ length: onePlaybook.version }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </NativeSelect>
        )}
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="contents">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-expanded={moreOpen}>
              <SlidersHorizontal aria-hidden />
              {moreOpen ? "Fewer filters" : "More filters"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex w-full flex-wrap items-center gap-2">
            {MORE.map((k) =>
              k === "tag" ? (
                <div key={k} className="flex items-center gap-1">
                  {select(k)}
                  {(filter.values.tag?.length ?? 0) > 0 && (
                    <NativeSelect
                      aria-label="Tag match"
                      className="h-8 w-20 text-xs"
                      value={filter.tagMode}
                      onChange={(e) =>
                        onChange({ ...filter, tagMode: e.target.value as Filter["tagMode"] })
                      }
                    >
                      <option value="any">any</option>
                      <option value="all">all</option>
                      <option value="none">none</option>
                    </NativeSelect>
                  )}
                </div>
              ) : (
                select(k)
              ),
            )}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Readiness</span>
              <Input
                type="number"
                min={1}
                max={5}
                step={0.5}
                aria-label="Readiness from"
                className="h-8 w-16"
                value={filter.readinessMin ?? ""}
                onChange={(e) =>
                  onChange({
                    ...filter,
                    readinessMin: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="number"
                min={1}
                max={5}
                step={0.5}
                aria-label="Readiness to"
                className="h-8 w-16"
                value={filter.readinessMax ?? ""}
                onChange={(e) =>
                  onChange({
                    ...filter,
                    readinessMax: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-chips">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.without)}
              className="bg-primary/15 hover:bg-primary/25 focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs outline-none focus-visible:ring-[3px]"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label}
              <X className="size-3" aria-hidden />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() =>
              onChange({
                ...filter,
                values: {},
                playbookVersion: null,
                readinessMin: null,
                readinessMax: null,
                tagMode: "any",
              })
            }
          >
            Clear all
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {RANGE_LABEL[filter.range]}
      </p>
    </div>
  );
}
