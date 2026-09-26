"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChipMulti, Field } from "@/components/form/field";
import { Markdown } from "@/components/prep/markdown";
import { SaveStatus } from "@/components/trade/save-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { AutosaveController, browserStore, type AutosaveStatus } from "@/lib/autosave/controller";
import { logClientError } from "@/lib/client-errors";
import { DOMAINS, domainMeta, type DomainCode } from "@/lib/domains";
import {
  PLAYBOOK_STATUSES,
  STATUS_LABEL,
  TEXT_SECTIONS,
  canSavePlaybook,
  moveItem,
  toPlaybookPayload,
  type PlaybookSnapshot,
  type PlaybookStatus,
} from "@/lib/playbook/form";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PlaybookEditorProps = {
  initial: PlaybookSnapshot;
  isNew: boolean;
  version: number;
  updatedAt: string | null;
  symbols: string[];
};

/**
 * Playbook template with autosave. Structured edits create one new version
 * per editing session (see `save_playbook`); notes never do.
 */
export function PlaybookEditor({
  initial,
  isNew,
  version: v0,
  updatedAt,
  symbols,
}: PlaybookEditorProps) {
  const router = useRouter();
  const storageKey = `cg:playbook:${initial.id}`;
  const [start] = useState(() => {
    const raw = browserStore.get(storageKey);
    if (raw) {
      try {
        const rec = JSON.parse(raw) as { snapshot: PlaybookSnapshot; at: number };
        if (rec.snapshot?.id === initial.id && (!updatedAt || rec.at > Date.parse(updatedAt)))
          return { snap: rec.snapshot, recovered: true };
      } catch {
        /* ignore corrupt copy */
      }
      browserStore.remove(storageKey);
    }
    return { snap: initial, recovered: false };
  });
  const [snap, setSnap] = useState(start.snap);
  const [mode, setMode] = useState<"read" | "edit">(isNew ? "edit" : "read");
  const [status, setStatus] = useState<AutosaveStatus>(isNew ? "idle" : "saved");
  const [version, setVersion] = useState(v0);
  const [persisted, setPersisted] = useState(!isNew);

  const [controller] = useState(() => {
    const supabase = createClient();
    const session = crypto.randomUUID();
    return new AutosaveController<PlaybookSnapshot>({
      storageKey,
      store: browserStore,
      canSave: canSavePlaybook,
      save: async (s) => {
        const { data, error } = await supabase.rpc("save_playbook", {
          p: toPlaybookPayload(s) as Json,
          p_session: session,
        });
        if (error) throw error;
        if (typeof data === "number") setVersion(data);
      },
      onStatus: (st, err) => {
        setStatus(st);
        if (st === "error") logClientError("playbook.autosave", err, { id: initial.id });
      },
      onSaved: () => setPersisted(true),
    });
  });

  const change = (patch: Partial<PlaybookSnapshot>) => {
    const next = { ...snap, ...patch };
    setSnap(next);
    controller.update(next);
  };

  useEffect(() => {
    if (start.recovered) {
      controller.update(start.snap);
      toast.info("Restored unsaved playbook changes from this device");
    }
  }, [start, controller]);

  useEffect(() => {
    if (isNew && persisted) window.history.replaceState(null, "", `/playbook/${initial.id}`);
  }, [isNew, persisted, initial.id]);

  // A new version changes the History/Stats tabs: re-render them (this editor keeps its state).
  useEffect(() => {
    if (!isNew && version !== v0) router.refresh();
  }, [isNew, version, v0, router]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved() && controller.getStatus() !== "blocked") e.preventDefault();
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

  async function softDelete() {
    await controller.flush();
    const supabase = createClient();
    const { error } = await supabase
      .from("playbooks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", snap.id);
    if (error) {
      logClientError("playbook.delete", error, { id: snap.id });
      toast.error("Not deleted — retry.");
      return;
    }
    toast(`Deleted "${snap.name}"`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await supabase.from("playbooks").update({ deleted_at: null }).eq("id", snap.id);
          if (r.error) toast.error("Undo failed — retry.");
          else router.push(`/playbook/${snap.id}`);
        },
      },
    });
    router.push("/playbook");
    router.refresh();
  }

  const d = domainMeta(snap.primaryDomain);
  const marketOptions = [...new Set([...symbols, ...snap.markets])];

  return (
    <div className="space-y-5" data-testid="playbook-editor">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <span className={cn("size-2 rounded-full", d.bgClassName)} aria-hidden />
          {d.short}
        </Badge>
        <Badge variant="outline" data-testid="playbook-version">
          v{version}
        </Badge>
        <Segmented
          label="Mode"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "read", label: "Read" },
            { value: "edit", label: "Edit" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus
            status={status}
            onRetry={() => void controller.retry()}
            missing={canSavePlaybook(snap) ? undefined : ["name"]}
          />
          {persisted && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={softDelete}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          )}
        </div>
      </div>

      {mode === "read" ? (
        <ReadView snap={snap} />
      ) : (
        <div className="space-y-5">
          <Field id="pb-name" label="Name *">
            <Input
              id="pb-name"
              value={snap.name}
              onChange={(e) => change({ name: e.target.value })}
              className="text-base font-semibold"
              placeholder="First test of beginning zone — passive limit pullback"
            />
          </Field>
          <Field id="pb-status" label="Status">
            <Segmented
              label="Status"
              size="sm"
              value={snap.status}
              onChange={(status) => change({ status: status as PlaybookStatus })}
              options={PLAYBOOK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
          </Field>
          <Field id="pb-domain" label="Primary domain">
            <Segmented
              label="Primary domain"
              size="sm"
              value={snap.primaryDomain}
              onChange={(v) =>
                change({
                  primaryDomain: v as DomainCode,
                  secondaryDomains: snap.secondaryDomains.filter((x) => x !== v),
                })
              }
              options={DOMAINS.map((x) => ({
                value: x.code,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", x.bgClassName)} aria-hidden />
                    {x.short}
                  </span>
                ),
              }))}
            />
          </Field>
          <Field id="pb-secondary" label="Secondary domains">
            <ChipMulti
              label="Secondary domains"
              value={snap.secondaryDomains}
              onChange={(v) => change({ secondaryDomains: v as DomainCode[] })}
              options={DOMAINS.filter((x) => x.code !== snap.primaryDomain).map((x) => ({
                value: x.code,
                label: x.short,
                dot: x.bgClassName,
              }))}
            />
          </Field>
          <Field id="pb-markets" label="Markets">
            <ChipMulti
              label="Markets"
              value={snap.markets}
              onChange={(markets) => change({ markets })}
              options={marketOptions.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field id="pb-summary" label="One-line summary">
            <Input
              id="pb-summary"
              value={snap.summary}
              onChange={(e) => change({ summary: e.target.value })}
            />
          </Field>
          {TEXT_SECTIONS.map((s) => (
            <Field key={s.key} id={`pb-${s.key}`} label={s.label}>
              <p className="text-muted-foreground -mt-1 text-xs">{s.hint}</p>
              <Textarea
                id={`pb-${s.key}`}
                rows={4}
                value={snap[s.key]}
                onChange={(e) => change({ [s.key]: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          ))}

          <fieldset className="space-y-2" data-testid="checklist-editor">
            <legend className="mb-1.5 text-xs font-medium">
              Pre-entry checklist (shown when logging a trade on this playbook)
            </legend>
            {snap.checklist.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1">
                <Input
                  aria-label={`Checklist item ${i + 1}`}
                  value={c.text}
                  onChange={(e) =>
                    change({
                      checklist: snap.checklist.map((x) =>
                        x.id === c.id ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => change({ checklist: moveItem(snap.checklist, i, -1) })}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  disabled={i === snap.checklist.length - 1}
                  onClick={() => change({ checklist: moveItem(snap.checklist, i, 1) })}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove checklist item"
                  onClick={() => change({ checklist: snap.checklist.filter((x) => x.id !== c.id) })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                change({ checklist: [...snap.checklist, { id: crypto.randomUUID(), text: "" }] })
              }
            >
              <Plus aria-hidden />
              Add checklist item
            </Button>
          </fieldset>

          <Field id="pb-notes" label="Free notes (markdown — never creates a version)">
            <Textarea
              id="pb-notes"
              rows={6}
              value={snap.notesMd}
              onChange={(e) => change({ notesMd: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function ReadView({ snap }: { snap: PlaybookSnapshot }) {
  return (
    <article className="space-y-5" data-testid="playbook-read">
      <header className="space-y-1">
        <h2 className="text-xl font-bold">{snap.name || "Untitled playbook"}</h2>
        <p className="text-muted-foreground text-sm">
          {STATUS_LABEL[snap.status]}
          {snap.markets.length > 0 && ` · ${snap.markets.join(" ")}`}
          {snap.secondaryDomains.length > 0 &&
            ` · also ${snap.secondaryDomains.map((d) => domainMeta(d).short).join(", ")}`}
        </p>
        {snap.summary && <p className="text-base">{snap.summary}</p>}
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {TEXT_SECTIONS.map((s) => (
          <section key={s.key} className="bg-card space-y-2 rounded-xl border p-4">
            <h3 className="heading-caps text-xs">{s.label}</h3>
            {snap[s.key].trim() ? (
              <Markdown>{snap[s.key]}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">Not written yet.</p>
            )}
          </section>
        ))}
      </div>
      <section className="bg-card space-y-2 rounded-xl border p-4">
        <h3 className="heading-caps text-xs">Pre-entry checklist</h3>
        {snap.checklist.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {snap.checklist
              .filter((c) => c.text.trim())
              .map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">No checklist items.</p>
        )}
      </section>
      {snap.notesMd.trim() && (
        <section className="bg-card space-y-2 rounded-xl border p-4">
          <h3 className="heading-caps text-xs">Notes</h3>
          <Markdown>{snap.notesMd}</Markdown>
        </section>
      )}
    </article>
  );
}
