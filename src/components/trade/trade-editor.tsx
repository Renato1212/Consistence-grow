"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChipMulti, Field } from "@/components/form/field";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { AutosaveController, browserStore, type AutosaveStatus } from "@/lib/autosave/controller";
import { logClientError } from "@/lib/client-errors";
import type { EditorData } from "@/lib/data/editor";
import { DOMAINS, type DomainCode } from "@/lib/domains";
import { createClient } from "@/lib/supabase/client";
import {
  ENTRY_TYPES,
  EXIT_REASON_LABEL,
  EXIT_REASONS,
  GRADES,
  emptyTradeForm,
  nowLocalInput,
  toTradePayload,
  type TradeFormValues,
} from "@/lib/trading/trade-form";
import { cn } from "@/lib/utils";
import { MediaManager, type MediaItem } from "./media-manager";
import { LivePreview } from "./live-preview";
import { SaveStatus } from "./save-status";
import { TradeLinks } from "./trade-links";

const DRAFT_PREFIX = "cg:trade:";

const FIELD_LABEL: Partial<Record<keyof TradeFormValues, string>> = {
  instrumentId: "instrument",
  direction: "direction",
  entryAt: "entry time",
  entryPrice: "entry price",
  exitAt: "exit time",
  exitPrice: "exit price",
  contracts: "size",
  primaryDomain: "domain",
};

export type TradeEditorProps = {
  data: EditorData;
  mode: "new" | "edit";
  initial?: { values: TradeFormValues; updatedAt: string; media: MediaItem[] };
  /** New-trade mode: id of an unconfirmed local draft to continue. */
  restoreId?: string;
};

/** Find the most recent unconfirmed draft left on this device (crash, closed tab…). */
function findOrphanDraft(exceptId: string): { values: TradeFormValues; at: number } | null {
  try {
    let best: { values: TradeFormValues; at: number } | null = null;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(DRAFT_PREFIX) || key === DRAFT_PREFIX + exceptId) continue;
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
        snapshot: TradeFormValues;
        at: number;
      } | null;
      if (parsed?.snapshot?.id && (!best || parsed.at > best.at)) {
        best = { values: parsed.snapshot, at: parsed.at };
      }
    }
    return best;
  } catch {
    return null;
  }
}

export function TradeEditor({ data, mode, initial, restoreId }: TradeEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const instruments = data.instruments;
  const findInst = useCallback((id: string) => instruments.find((i) => i.id === id), [instruments]);

  // Draft to continue (?restore=…), read once from this device.
  const [restored] = useState<TradeFormValues | null>(() => {
    if (!restoreId || initial) return null;
    try {
      const raw = browserStore.get(DRAFT_PREFIX + restoreId);
      return raw ? (JSON.parse(raw) as { snapshot: TradeFormValues }).snapshot : null;
    } catch {
      return null;
    }
  });
  const [id] = useState(() => initial?.values.id ?? restored?.id ?? crypto.randomUUID());

  // Crash recovery: unsaved local changes newer than the server copy win.
  const [startValues] = useState<TradeFormValues>(() => {
    if (initial) {
      const rec = browserStore.get(DRAFT_PREFIX + initial.values.id);
      if (rec) {
        try {
          const parsed = JSON.parse(rec) as { snapshot: TradeFormValues; at: number };
          if (parsed.at > Date.parse(initial.updatedAt)) return parsed.snapshot;
        } catch {
          /* ignore corrupt draft */
        }
      }
      return initial.values;
    }
    if (restored) return restored;
    const active = instruments.filter((i) => i.active);
    const last = active.find((i) => i.id === data.lastInstrumentId);
    return emptyTradeForm({ id, instrumentId: (last ?? active[0])?.id });
  });
  const [recoveredOnLoad] = useState(
    () => (!!initial && startValues !== initial.values) || !!restored,
  );
  const [orphan, setOrphan] = useState(() =>
    mode === "new" && !restored ? findOrphanDraft(id) : null,
  );

  const form = useForm<TradeFormValues>({ defaultValues: startValues });
  const values = useWatch({ control: form.control }) as TradeFormValues;
  const inst = findInst(values.instrumentId);
  const result = useMemo(() => toTradePayload(values, inst), [values, inst]);

  const [status, setStatus] = useState<AutosaveStatus>(mode === "edit" ? "saved" : "idle");
  const [persisted, setPersisted] = useState(mode === "edit");
  const [controller] = useState(() => {
    // What the server has confirmed; closure-local, never read during render.
    let syncedTags: string[] = mode === "edit" ? (initial?.values.tagIds ?? []) : [];
    let syncedInstrument: string | null = data.lastInstrumentId;

    const save = async (v: TradeFormValues) => {
      const { payload } = toTradePayload(v, findInst(v.instrumentId));
      if (!payload) throw new Error("Trade not saveable");
      const { error } = await supabase.from("trades").upsert(payload);
      if (error) throw error;

      // Tags: apply the diff since the last confirmed save.
      const want = new Set(v.tagIds);
      const had = new Set(syncedTags);
      const add = [...want].filter((t) => !had.has(t));
      const remove = [...had].filter((t) => !want.has(t));
      if (add.length) {
        const r = await supabase.from("trade_tags").upsert(
          add.map((tag_id) => ({ trade_id: v.id, tag_id })),
          { ignoreDuplicates: true },
        );
        if (r.error) throw r.error;
      }
      if (remove.length) {
        const r = await supabase
          .from("trade_tags")
          .delete()
          .eq("trade_id", v.id)
          .in("tag_id", remove);
        if (r.error) throw r.error;
      }
      syncedTags = [...want];

      if (syncedInstrument !== v.instrumentId) {
        const r = await supabase
          .from("user_settings")
          .update({ last_instrument_id: v.instrumentId })
          .not("id", "is", null);
        if (!r.error) syncedInstrument = v.instrumentId;
      }
    };

    return new AutosaveController<TradeFormValues>({
      storageKey: DRAFT_PREFIX + id,
      store: browserStore,
      canSave: (v) => toTradePayload(v, findInst(v.instrumentId)).payload !== null,
      save,
      onStatus: (s, err) => {
        setStatus(s);
        if (s === "error") logClientError("trade.autosave", err, { tradeId: id });
      },
      onSaved: () => setPersisted(true),
    });
  });

  // Feed every change to the autosave controller (only real edits, not mount).
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: () => controller.update(form.getValues()),
      }),
    [form, controller],
  );

  // Restored local changes on an existing trade: push them to the server now.
  useEffect(() => {
    if (recoveredOnLoad) {
      controller.update(form.getValues());
      toast.info("Restored unsaved changes from this device");
    }
  }, [recoveredOnLoad, controller, form]);

  // New trade: once it exists on the server, give it its permanent URL.
  useEffect(() => {
    if (mode === "new" && persisted) {
      window.history.replaceState(null, "", `/journal/${id}`);
    }
  }, [mode, persisted, id]);

  // Never leave with unsaved changes; save immediately when the app is backgrounded.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved() && controller.getStatus() !== "blocked") {
        e.preventDefault();
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") void controller.flush();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      void controller.flush();
      controller.dispose();
    };
  }, [controller]);

  const done = useCallback(async () => {
    await controller.flush();
    if (controller.getStatus() === "error") {
      toast.error("Not saved yet — check your connection and retry.");
      return;
    }
    router.push(persisted ? `/journal?trade=${id}` : "/journal");
    router.refresh();
  }, [controller, router, persisted, id]);

  // ⌘/Ctrl+Enter = Done
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void done();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done]);

  async function softDelete() {
    await controller.flush();
    const { error } = await supabase
      .from("trades")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      logClientError("trade.delete", error, { tradeId: id });
      toast.error("Something failed, retry.");
      return;
    }
    controller.clearRecovery();
    toast("Trade moved to trash", {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await supabase.from("trades").update({ deleted_at: null }).eq("id", id);
          if (r.error) toast.error("Could not restore — find it in Trash.");
          else router.refresh();
        },
      },
    });
    router.push("/journal");
    router.refresh();
  }

  function restoreOrphan() {
    if (!orphan) return;
    // New `key` on the page remounts the editor with a fresh autosave controller.
    router.push(`/journal/new?restore=${orphan.values.id}`);
  }

  function discardOrphan() {
    if (orphan) browserStore.remove(DRAFT_PREFIX + orphan.values.id);
    setOrphan(null);
  }

  const missingLabels = result.missing.map((k) => FIELD_LABEL[k] ?? k);
  const err = result.errors;
  const isObserved = values.kind === "observed";
  const quickInstruments = useMemo(() => {
    const active = instruments.filter((i) => i.active);
    const last = active.find((i) => i.id === data.lastInstrumentId);
    const rest = active.filter((i) => i.id !== last?.id).slice(0, last ? 5 : 6);
    return last ? [last, ...rest] : rest;
  }, [instruments, data.lastInstrumentId]);
  const priceHint = inst?.priceFormat === "thirty_seconds" ? "e.g. 110'16.5" : undefined;
  const priceMode = inst?.priceFormat === "thirty_seconds" ? "text" : "decimal";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-caps text-lg">{mode === "new" ? "Log trade" : "Edit trade"}</h1>
        <div className="flex items-center gap-2">
          <SaveStatus
            status={status}
            onRetry={() => void controller.retry()}
            missing={missingLabels}
          />
          <Button onClick={() => void done()}>Done</Button>
        </div>
      </div>

      {orphan && (
        <div
          role="alert"
          className="bg-card flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 p-3 text-sm"
        >
          <span className="flex-1">
            You have an unsaved trade from{" "}
            {new Date(orphan.at).toLocaleString("en-GB", {
              dateStyle: "short",
              timeStyle: "short",
            })}
            .
          </span>
          <Button size="sm" onClick={restoreOrphan}>
            Restore
          </Button>
          <Button size="sm" variant="ghost" onClick={discardOrphan}>
            Discard
          </Button>
        </div>
      )}

      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate>
        {/* Kind */}
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Segmented
              label="Kind"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "taken", label: "Taken" },
                { value: "missed", label: "Missed" },
                { value: "observed", label: "Observed" },
              ]}
            />
          )}
        />

        {/* Instrument */}
        <fieldset className="space-y-2">
          <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">
            Instrument *
          </legend>
          <Controller
            control={form.control}
            name="instrumentId"
            render={({ field }) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <Segmented
                  label="Instrument"
                  value={quickInstruments.some((i) => i.id === field.value) ? field.value : null}
                  onChange={field.onChange}
                  options={quickInstruments.map((i) => ({ value: i.id, label: i.symbol }))}
                />
                <div className="w-32">
                  <NativeSelect
                    aria-label="Other instrument"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                  >
                    {instruments
                      .filter((i) => i.active || i.id === field.value)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.symbol} — {i.name}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
              </div>
            )}
          />
        </fieldset>

        {/* Direction */}
        <fieldset>
          <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">
            {isObserved ? "Move direction *" : "Direction *"}
          </legend>
          <Controller
            control={form.control}
            name="direction"
            render={({ field }) => (
              <Segmented
                label="Direction"
                value={field.value}
                onChange={field.onChange}
                options={[
                  {
                    value: "long",
                    label: (
                      <span className="flex items-center gap-1.5">
                        <ArrowUpRight className="size-4" aria-hidden /> {isObserved ? "Up" : "Long"}
                      </span>
                    ),
                    className: "flex-1 sm:flex-none sm:min-w-28",
                  },
                  {
                    value: "short",
                    label: (
                      <span className="flex items-center gap-1.5">
                        <ArrowDownRight className="size-4" aria-hidden />{" "}
                        {isObserved ? "Down" : "Short"}
                      </span>
                    ),
                    className: "flex-1 sm:flex-none sm:min-w-28",
                  },
                ]}
              />
            )}
          />
        </fieldset>

        {/* Entry / exit */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="entryPrice"
            label={isObserved ? "Start price *" : "Entry price *"}
            error={err.entryPrice}
          >
            <Input
              id="entryPrice"
              inputMode={priceMode}
              placeholder={priceHint}
              autoComplete="off"
              {...form.register("entryPrice")}
            />
          </Field>
          <Field
            id="exitPrice"
            label={isObserved ? "End price *" : "Exit price *"}
            error={err.exitPrice}
          >
            <Input
              id="exitPrice"
              inputMode={priceMode}
              placeholder={priceHint}
              autoComplete="off"
              {...form.register("exitPrice")}
            />
          </Field>
          {!isObserved && (
            <Field id="contracts" label="Contracts *" error={err.contracts}>
              <Input
                id="contracts"
                inputMode="decimal"
                autoComplete="off"
                {...form.register("contracts")}
              />
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="entryAt"
            label={isObserved ? "Start time *" : "Entry time *"}
            error={err.entryAt}
            hint="Lisbon"
          >
            <Input id="entryAt" type="datetime-local" step={1} {...form.register("entryAt")} />
          </Field>
          <Field
            id="exitAt"
            label={isObserved ? "End time *" : "Exit time *"}
            error={err.exitAt}
            hint="Lisbon"
          >
            <div className="flex gap-1">
              <Input id="exitAt" type="datetime-local" step={1} {...form.register("exitAt")} />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Set exit time to now"
                onClick={() => form.setValue("exitAt", nowLocalInput(), { shouldDirty: true })}
              >
                <Clock aria-hidden />
              </Button>
            </div>
          </Field>
        </div>

        {/* Primary domain */}
        <fieldset>
          <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">
            Primary domain *
          </legend>
          <Controller
            control={form.control}
            name="primaryDomain"
            render={({ field }) => (
              <Segmented
                label="Primary domain"
                value={field.value}
                onChange={field.onChange}
                size="sm"
                options={DOMAINS.map((d) => ({
                  value: d.code,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
                      {d.short}
                    </span>
                  ),
                }))}
              />
            )}
          />
        </fieldset>

        <LivePreview values={values} inst={inst} />

        {/* Media */}
        <MediaManager
          ownerType="trade"
          ownerId={id}
          ready={persisted}
          initial={initial?.media ?? []}
          pasteTarget="window"
        />

        {/* More details */}
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger className="heading-caps group flex w-full items-center justify-between p-4 text-xs">
            More details
            <ChevronDown
              className="size-4 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 border-t p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field id="stopPrice" label="Stop" error={err.stopPrice}>
                <Input
                  id="stopPrice"
                  inputMode={priceMode}
                  placeholder={priceHint}
                  autoComplete="off"
                  {...form.register("stopPrice")}
                />
              </Field>
              <Field id="targetPrice" label="Initial target" error={err.targetPrice}>
                <Input
                  id="targetPrice"
                  inputMode={priceMode}
                  placeholder={priceHint}
                  autoComplete="off"
                  {...form.register("targetPrice")}
                />
              </Field>
              <Field id="plannedR" label="Planned R" error={err.plannedR}>
                <Input
                  id="plannedR"
                  inputMode="decimal"
                  autoComplete="off"
                  {...form.register("plannedR")}
                />
              </Field>
              {!isObserved && (
                <Field
                  id="fees"
                  label="Fees (override)"
                  error={err.fees}
                  hint={inst ? `default ${inst.feePerContract}/contract` : undefined}
                >
                  <Input
                    id="fees"
                    inputMode="decimal"
                    autoComplete="off"
                    {...form.register("fees")}
                  />
                </Field>
              )}
              <Field id="maeTicks" label="MAE (ticks)" error={err.maeTicks}>
                <Input
                  id="maeTicks"
                  inputMode="decimal"
                  autoComplete="off"
                  {...form.register("maeTicks")}
                />
              </Field>
              <Field id="mfeTicks" label="MFE (ticks)" error={err.mfeTicks}>
                <Input
                  id="mfeTicks"
                  inputMode="decimal"
                  autoComplete="off"
                  {...form.register("mfeTicks")}
                />
              </Field>
            </div>

            <fieldset>
              <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">
                Secondary domains
              </legend>
              <Controller
                control={form.control}
                name="secondaryDomains"
                render={({ field }) => (
                  <ChipMulti
                    label="Secondary domains"
                    options={DOMAINS.filter((d) => d.code !== values.primaryDomain).map((d) => ({
                      value: d.code,
                      label: d.short,
                      dot: d.bgClassName,
                    }))}
                    value={field.value}
                    onChange={(v) => field.onChange(v as DomainCode[])}
                  />
                )}
              />
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="playbookId" label="Playbook">
                <NativeSelect id="playbookId" {...form.register("playbookId")}>
                  <option value="">—</option>
                  {data.playbooks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!isObserved && (
                <Field id="entryType" label="Entry type">
                  <Controller
                    control={form.control}
                    name="entryType"
                    render={({ field }) => (
                      <NativeSelect
                        id="entryType"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      >
                        <option value="">—</option>
                        {ENTRY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t === "limit"
                              ? "Limit (passive)"
                              : t === "market"
                                ? "Market (aggressive)"
                                : "Stop"}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </Field>
              )}
              {!isObserved && (
                <Field id="exitReason" label="Exit reason">
                  <Controller
                    control={form.control}
                    name="exitReason"
                    render={({ field }) => (
                      <NativeSelect
                        id="exitReason"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      >
                        <option value="">—</option>
                        {EXIT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {EXIT_REASON_LABEL[r]}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </Field>
              )}
            </div>

            <TradeLinks
              control={form.control}
              entryAt={values.entryAt}
              instrumentId={values.instrumentId}
              eventId={values.calendarEventId ?? ""}
            />

            {!isObserved && (
              <fieldset>
                <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">
                  Pre-trade confidence
                </legend>
                <Controller
                  control={form.control}
                  name="confidence"
                  render={({ field }) => (
                    <Segmented
                      label="Confidence"
                      size="sm"
                      value={field.value === null ? null : String(field.value)}
                      onChange={(v) => field.onChange(Number(v))}
                      options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }))}
                    />
                  )}
                />
              </fieldset>
            )}

            {!isObserved && (
              <div className="space-y-3">
                {(
                  [
                    ["gradeContext", "gradeContextReason", "Context"],
                    ["gradeEdge", "gradeEdgeReason", "Edge"],
                    ["gradeProcess", "gradeProcessReason", "Process"],
                  ] as const
                ).map(([grade, reason, label]) => (
                  <div key={grade} className="grid items-center gap-2 sm:grid-cols-[7rem_auto_1fr]">
                    <span className="heading-caps text-[11px]">{label}</span>
                    <Controller
                      control={form.control}
                      name={grade}
                      render={({ field }) => (
                        <Segmented
                          label={`${label} grade`}
                          size="sm"
                          value={field.value}
                          onChange={field.onChange}
                          options={GRADES.map((g) => ({ value: g, label: g }))}
                        />
                      )}
                    />
                    <Input
                      aria-label={`${label} reason`}
                      placeholder="Why? (optional)"
                      {...form.register(reason)}
                    />
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  Process grade is about execution, not outcome.
                </p>
              </div>
            )}

            <fieldset>
              <legend className="heading-caps text-muted-foreground mb-2 text-[10px]">Tags</legend>
              <Controller
                control={form.control}
                name="tagIds"
                render={({ field }) => (
                  <div className="space-y-3">
                    {data.tagGroups.map((g) => (
                      <div key={g.id}>
                        <div className="text-muted-foreground mb-1.5 text-xs">{g.name}</div>
                        <ChipMulti
                          label={g.name}
                          options={g.tags.map((t) => ({ value: t.id, label: t.name }))}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              />
            </fieldset>

            {isObserved ? (
              <div className="grid gap-3">
                <Field id="moveTrigger" label="What triggered the move?">
                  <Textarea id="moveTrigger" {...form.register("moveTrigger")} />
                </Field>
                <Field id="movePhases" label="Phases of the move">
                  <Textarea id="movePhases" {...form.register("movePhases")} />
                </Field>
              </div>
            ) : null}

            <div className="grid gap-3">
              <Field id="thesis" label={isObserved ? "Notes" : "Thesis (why)"}>
                <Textarea id="thesis" {...form.register("thesis")} />
              </Field>
              {!isObserved && (
                <Field id="management" label="Management">
                  <Textarea id="management" {...form.register("management")} />
                </Field>
              )}
              <Field id="lesson" label="Lesson">
                <Textarea id="lesson" {...form.register("lesson")} />
              </Field>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </form>

      {mode === "edit" && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => void softDelete()}
          >
            <Trash2 aria-hidden /> Delete trade
          </Button>
        </div>
      )}
    </div>
  );
}
